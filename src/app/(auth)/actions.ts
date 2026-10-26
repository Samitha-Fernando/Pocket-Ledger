"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { burnVerifyTime, hashSecret, normalizeInviteCode, sha256, verifySecret } from "@/lib/auth/crypto";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_PINS,
  afterFailedLogin,
  checkPassword,
  isAccountLocked,
} from "@/lib/auth/policy";
import {
  audit,
  endCurrentSession,
  getCurrentSession,
  getDeviceSessionById,
  isIpBlocked,
  lockCurrentSession,
  recordAttempt,
  startSession,
} from "@/lib/auth/session";
import {
  type FormState,
  checkEmail,
  checkName,
  checkUsername,
  field,
  normalizeEmail,
} from "@/lib/auth/validate";

const TOO_MANY = "Too many failed attempts from this device. Please wait 15 minutes and try again.";
const LOCKED = `This account is locked for ${LOCKOUT_MINUTES} minutes after too many failed attempts.`;

function readNewAccount(fd: FormData) {
  const name = field(fd, "name");
  const email = normalizeEmail(field(fd, "email"));
  const username = field(fd, "username").toLowerCase();
  const password = fd.get("password")?.toString() ?? "";
  const confirm = fd.get("confirm")?.toString() ?? "";
  const error =
    checkName(name) ??
    checkEmail(email) ??
    checkUsername(username) ??
    checkPassword(password) ??
    (password !== confirm ? "Passwords don't match." : null);
  return { name, email, username: username || null, password, error };
}

async function accountTaken(email: string, username: string | null) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, ...(username ? [{ username }] : [])] },
    select: { id: true },
  });
  return existing !== null;
}

/** First run only: creates the admin account. */
export async function setupAdmin(_prev: FormState, fd: FormData): Promise<FormState> {
  if ((await prisma.user.count()) > 0) redirect("/login");

  const input = readNewAccount(fd);
  if (input.error) return { error: input.error };

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      username: input.username,
      passwordHash: await hashSecret(input.password),
      role: "ADMIN",
    },
  });
  await startSession(user.id);
  await audit(user.id, "account_created", "Admin account (first-run setup)");
  redirect("/settings?welcome=1");
}

/** Invite-only registration. */
export async function register(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await isIpBlocked("register")) return { error: TOO_MANY };

  const input = readNewAccount(fd);
  if (input.error) return { error: input.error };

  const code = normalizeInviteCode(field(fd, "code"));
  const invite = await prisma.invite.findUnique({ where: { codeHash: sha256(code) } });
  const now = new Date();
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt < now) {
    await recordAttempt("register", false, input.email);
    return { error: "That invite code isn't valid or has expired. Ask the admin for a new one." };
  }
  if (invite.email && invite.email !== input.email) {
    await recordAttempt("register", false, input.email);
    return { error: "This invite was issued for a different email address." };
  }
  if (await accountTaken(input.email, input.username)) {
    return { error: "That email or username is already registered." };
  }

  const passwordHash = await hashSecret(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: input.name, email: input.email, username: input.username, passwordHash },
    });
    // Claim the invite only if still unused (guards against double use).
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, usedById: created.id },
    });
    if (claimed.count !== 1) throw new Error("Invite already used");
    return created;
  });

  await recordAttempt("register", true, input.email);
  await startSession(user.id);
  await audit(user.id, "account_created", "Registered with invite");
  redirect("/settings?welcome=1");
}

/** Checks a password against an account, applying the lockout rules. */
async function checkUserPassword(
  user: { id: string; passwordHash: string; failedLoginCount: number; lockedUntil: Date | null },
  password: string,
  kind: string,
): Promise<string | null> {
  if (isAccountLocked(user.lockedUntil)) {
    await recordAttempt(kind, false, user.id);
    return LOCKED;
  }
  if (!(await verifySecret(user.passwordHash, password))) {
    const next = afterFailedLogin(user.failedLoginCount);
    await prisma.user.update({ where: { id: user.id }, data: next });
    await recordAttempt(kind, false, user.id);
    await audit(user.id, "login_failed", next.lockedUntil ? "Account locked" : undefined);
    return next.lockedUntil ? LOCKED : "Email/username or password is incorrect.";
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  return null;
}

export async function login(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await isIpBlocked("login")) return { error: TOO_MANY };

  const identifier = field(fd, "identifier").toLowerCase();
  const password = fd.get("password")?.toString() ?? "";
  if (!identifier || !password) return { error: "Enter your email/username and password." };

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });
  if (!user) {
    await burnVerifyTime(password);
    await recordAttempt("login", false, identifier);
    return { error: "Email/username or password is incorrect." };
  }

  if (user.disabledAt) {
    await burnVerifyTime(password);
    await recordAttempt("login", false, user.id);
    return { error: "This account has been disabled. Please contact the admin." };
  }
  const error = await checkUserPassword(user, password, "login");
  if (error) return { error };

  await recordAttempt("login", true, user.id);
  await startSession(user.id);
  await audit(user.id, "login");
  redirect("/");
}

/** Unlocks a locked session on this device with PIN or password. */
export async function unlock(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await isIpBlocked("unlock")) return { error: TOO_MANY };

  const sessionId = field(fd, "sessionId");
  const method = field(fd, "method");
  const secret = fd.get("secret")?.toString() ?? "";

  let session;
  if (sessionId) {
    session = await getDeviceSessionById(sessionId);
  } else {
    const current = await getCurrentSession();
    session = current.state === "none" ? null : current.session;
  }
  if (!session) redirect("/login");
  const user = session.user;
  if (user.disabledAt) redirect("/login");

  if (method === "pin") {
    if (!user.pinHash || session.pinFailedCount >= MAX_FAILED_PINS) {
      return { error: "Please use your password.", needPassword: true };
    }
    if (!(await verifySecret(user.pinHash, secret))) {
      const failed = session.pinFailedCount + 1;
      await prisma.session.update({ where: { id: session.id }, data: { pinFailedCount: failed } });
      await recordAttempt("unlock", false, user.id);
      await audit(user.id, "pin_failed");
      return failed >= MAX_FAILED_PINS
        ? { error: "Too many wrong PINs. Please enter your password.", needPassword: true }
        : { error: `Wrong PIN. ${MAX_FAILED_PINS - failed} tries left.` };
    }
  } else {
    const error = await checkUserPassword(user, secret, "unlock");
    if (error) return { error };
  }

  await recordAttempt("unlock", true, user.id);
  await startSession(user.id);
  await audit(user.id, method === "pin" ? "unlock_pin" : "unlock_password");
  redirect("/");
}

export async function lockAction() {
  await lockCurrentSession();
  redirect("/lock");
}

export async function switchUserAction() {
  await lockCurrentSession();
  redirect("/switch");
}

export async function signOutAction() {
  const current = await getCurrentSession();
  if (current.state !== "none") await audit(current.user.id, "sign_out");
  await endCurrentSession();
  redirect("/switch");
}
