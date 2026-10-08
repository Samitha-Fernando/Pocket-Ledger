import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts } from "@/lib/ledger/accounts";
import { newToken, sha256 } from "./crypto";
import { IP_ATTEMPT_LIMIT, IP_WINDOW_MINUTES, SESSION_DAYS, isIdleExpired } from "./policy";

// Two cookies, both httpOnly (page scripts can't read them):
//   pl_device  – identifies this browser/device; lets several people keep a
//                remembered login on the same computer (for "Switch user").
//   pl_session – the currently active login on this device.
export const SESSION_COOKIE = "pl_session";
export const DEVICE_COOKIE = "pl_device";

const DAY_MS = 86_400_000;
const TOUCH_EVERY_MS = 30_000;

const secureCookies = () => (process.env.APP_URL ?? "").startsWith("https://");

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function getClientIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "local";
}

/** Hash of this device's id; creates the device cookie if asked (actions only). */
export async function getDeviceHash(create = false) {
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    if (!create) return null;
    deviceId = newToken();
    jar.set(DEVICE_COOKIE, deviceId, cookieOptions(400 * 86_400));
  }
  return sha256(deviceId);
}

/** Starts (or refreshes) this user's login on this device. Server actions only. */
export async function startSession(userId: string) {
  const deviceHash = (await getDeviceHash(true))!;
  const token = newToken();
  const h = await headers();
  const now = new Date();

  await prisma.$transaction([
    // Anyone else logged in on this device gets locked.
    prisma.session.updateMany({
      where: { deviceHash, userId: { not: userId } },
      data: { locked: true },
    }),
    prisma.session.upsert({
      where: { deviceHash_userId: { deviceHash, userId } },
      create: {
        userId,
        deviceHash,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS),
        userAgent: h.get("user-agent")?.slice(0, 200),
      },
      update: {
        tokenHash: sha256(token),
        locked: false,
        pinFailedCount: 0,
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS),
      },
    }),
  ]);

  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86_400));
}

export type CurrentSession =
  | { state: "none" }
  | { state: "locked" | "active"; session: SessionWithUser; user: SessionWithUser["user"] };

type SessionWithUser = NonNullable<Awaited<ReturnType<typeof findSession>>>;

function findSession(tokenHash: string) {
  return prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
}

/** Reads the active session for this request (cached per request). */
export const getCurrentSession = cache(async (): Promise<CurrentSession> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { state: "none" };

  const session = await findSession(sha256(token));
  const now = new Date();
  if (!session || session.expiresAt < now) return { state: "none" };

  if (session.locked) return { state: "locked", session, user: session.user };

  if (isIdleExpired(session.lastActiveAt, session.user.autoLockMinutes, now)) {
    await prisma.session.update({ where: { id: session.id }, data: { locked: true } });
    return { state: "locked", session, user: session.user };
  }

  if (now.getTime() - session.lastActiveAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: now } });
  }
  return { state: "active", session, user: session.user };
});

/** Use at the top of every protected page and server action. */
export async function requireUser() {
  const current = await getCurrentSession();
  if (current.state === "none") redirect("/login");
  if (current.state === "locked") redirect("/lock");
  return current.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

/** Database client limited to the signed-in user's own data. */
export async function getUserDb() {
  const user = await requireUser();
  return { user, db: scopedDb(prisma, user.id) };
}

/** Like getUserDb, and makes sure the default accounts exist (once per request). */
export const getLedger = cache(async () => {
  const { user, db } = await getUserDb();
  await ensureDefaultAccounts(db);
  return { user, db };
});

export async function lockCurrentSession() {
  const current = await getCurrentSession();
  if (current.state !== "none") {
    await prisma.session.update({ where: { id: current.session.id }, data: { locked: true } });
  }
}

/** Signs out of this device completely (PIN unlock no longer possible). */
export async function endCurrentSession() {
  const current = await getCurrentSession();
  if (current.state !== "none") {
    await prisma.session.delete({ where: { id: current.session.id } }).catch(() => {});
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/** Remembered logins on this device, for the "Switch user" screen. */
export async function getDeviceSessions() {
  const deviceHash = await getDeviceHash();
  if (!deviceHash) return [];
  return prisma.session.findMany({
    where: { deviceHash, expiresAt: { gt: new Date() } },
    select: { id: true, user: { select: { name: true, pinHash: true } } },
    orderBy: { lastActiveAt: "desc" },
  });
}

/** A remembered session on this device, by id (never another device's). */
export async function getDeviceSessionById(id: string) {
  const deviceHash = await getDeviceHash();
  if (!deviceHash) return null;
  const session = await prisma.session.findFirst({
    where: { id, deviceHash, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  return session;
}

// ---- Rate limiting & audit -------------------------------------------------

export async function isIpBlocked(kind: string) {
  const ip = await getClientIp();
  const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000);
  const failures = await prisma.loginAttempt.count({
    where: { ip, kind, success: false, createdAt: { gte: since } },
  });
  return failures >= IP_ATTEMPT_LIMIT;
}

export async function recordAttempt(kind: string, success: boolean, identifier?: string) {
  const ip = await getClientIp();
  await prisma.loginAttempt.create({ data: { ip, kind, success, identifier } });
  // Keep the table small.
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - DAY_MS) } } });
}

export async function audit(userId: string, action: string, details?: string) {
  const ip = await getClientIp();
  await prisma.auditLog.create({ data: { userId, action, details, ip } });
}
