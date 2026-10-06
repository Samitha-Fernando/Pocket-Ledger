"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { hashSecret, newInviteCode, normalizeInviteCode, sha256, verifySecret } from "@/lib/auth/crypto";
import { AUTO_LOCK_MAX, AUTO_LOCK_MIN, INVITE_DAYS, checkPassword, checkPin } from "@/lib/auth/policy";
import { audit, getCurrentSession, requireAdmin, requireUser } from "@/lib/auth/session";
import { type FormState, checkEmail, field, normalizeEmail } from "@/lib/auth/validate";

async function confirmPassword(passwordHash: string, fd: FormData) {
  const current = fd.get("currentPassword")?.toString() ?? "";
  return verifySecret(passwordHash, current);
}

export async function setPin(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await confirmPassword(user.passwordHash, fd))) return { error: "Current password is incorrect." };

  const pin = field(fd, "pin");
  const error = checkPin(pin) ?? (pin !== field(fd, "confirmPin") ? "PINs don't match." : null);
  if (error) return { error };

  await prisma.user.update({ where: { id: user.id }, data: { pinHash: await hashSecret(pin) } });
  await prisma.session.updateMany({ where: { userId: user.id }, data: { pinFailedCount: 0 } });
  await audit(user.id, user.pinHash ? "pin_changed" : "pin_set");
  revalidatePath("/settings");
  return { success: "PIN saved. You can now unlock with your PIN on this device." };
}

export async function removePin(): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { pinHash: null } });
  await audit(user.id, "pin_removed");
  revalidatePath("/settings");
}

export async function setAutoLock(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const minutes = Number(field(fd, "minutes"));
  if (!Number.isInteger(minutes) || minutes < AUTO_LOCK_MIN || minutes > AUTO_LOCK_MAX) {
    return { error: `Choose between ${AUTO_LOCK_MIN} and ${AUTO_LOCK_MAX} minutes.` };
  }
  await prisma.user.update({ where: { id: user.id }, data: { autoLockMinutes: minutes } });
  revalidatePath("/", "layout");
  return { success: `Auto-lock set to ${minutes} minute${minutes === 1 ? "" : "s"}.` };
}

export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await confirmPassword(user.passwordHash, fd))) return { error: "Current password is incorrect." };

  const password = fd.get("password")?.toString() ?? "";
  const error = checkPassword(password) ?? (password !== fd.get("confirm")?.toString() ? "Passwords don't match." : null);
  if (error) return { error };

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashSecret(password) } });
  // Sign this account out everywhere except here.
  const current = await getCurrentSession();
  const keepId = current.state === "none" ? "" : current.session.id;
  await prisma.session.deleteMany({ where: { userId: user.id, id: { not: keepId } } });
  await audit(user.id, "password_changed");
  return { success: "Password changed. Other devices have been signed out." };
}

// ---- Admin: invites ---------------------------------------------------------

export type InviteState = { error?: string; success?: string; code?: string } | undefined;

export async function createInvite(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const email = field(fd, "email") ? normalizeEmail(field(fd, "email")) : null;
  if (email && checkEmail(email)) return { error: checkEmail(email)! };
  const note = field(fd, "note").slice(0, 80) || null;

  const code = newInviteCode();
  await prisma.invite.create({
    data: {
      codeHash: sha256(normalizeInviteCode(code)),
      note,
      email,
      createdById: admin.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  await audit(admin.id, "invite_created", note ?? email ?? undefined);
  revalidatePath("/settings");
  return { code, success: "Invite created. Copy the code now. It won't be shown again." };
}

export async function revokeInvite(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = field(fd, "id");
  await prisma.invite.updateMany({ where: { id, usedAt: null }, data: { revokedAt: new Date() } });
  await audit(admin.id, "invite_revoked");
  revalidatePath("/settings");
}
