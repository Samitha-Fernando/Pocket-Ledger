"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { hashSecret, newInviteCode, normalizeInviteCode, sha256, verifySecret } from "@/lib/auth/crypto";
import { AUTO_LOCK_MAX, AUTO_LOCK_MIN, INVITE_DAYS, checkPassword, checkPin } from "@/lib/auth/policy";
import { audit, getCurrentSession, getUserDb, requireAdmin, requireUser } from "@/lib/auth/session";
import { type FormState, checkEmail, field, normalizeEmail } from "@/lib/auth/validate";
import { formatMoney, parseMoneyToCents } from "@/lib/format";
import { CURRENCIES } from "@/lib/currencies";

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

export async function setLateIncome(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const on = field(fd, "enabled") === "on";
  const day = Number(field(fd, "day"));
  if (on && (!Number.isInteger(day) || day < 1 || day > 31)) return { error: "Choose a day between 1 and 31." };
  await prisma.user.update({ where: { id: user.id }, data: { lateIncomeDay: on ? day : null } });
  revalidatePath("/", "layout");
  return { success: on ? `Income on or after day ${day} will count toward the next month in reports.` : "Late income shift is off." };
}

export async function setAssetThreshold(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const cents = parseMoneyToCents(field(fd, "threshold"));
  if (cents === null || cents < 0 || cents > 2_000_000_000) return { error: "Enter an amount, e.g. 50,000" };
  await prisma.user.update({ where: { id: user.id }, data: { assetThresholdCents: cents } });
  revalidatePath("/", "layout");
  return { success: `Purchases of ${formatMoney(cents, user.currency)} or more will be suggested as assets.` };
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

// ---- Currency --------------------------------------------------------------------


export async function setCurrency(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const currency = field(fd, "currency");
  if (!(CURRENCIES as readonly string[]).includes(currency)) return { error: "Choose a currency." };
  await prisma.user.update({ where: { id: user.id }, data: { currency } });
  revalidatePath("/", "layout");
  return { success: "Currency saved. (Amounts aren't converted; only the symbol changes.)" };
}

// ---- Exchange rates (for accounts in another currency) ----------------------------------

export async function saveRateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, db } = await getUserDb();
  const currency = field(fd, "currency");
  const date = field(fd, "date");
  const { parseRate } = await import("@/lib/ledger/fx");
  const { rememberRate } = await import("@/lib/ledger/engine");
  const { isIsoDate } = await import("@/lib/format");
  const rate4 = parseRate(field(fd, "rate"));
  if (!(CURRENCIES as readonly string[]).includes(currency) || currency === user.currency) return { error: "Choose a currency." };
  if (!isIsoDate(date)) return { error: "Choose a valid date." };
  if (!rate4) return { error: "Enter the rate, e.g. 300.25" };
  await db.$transaction((tx) => rememberRate(tx, currency, date, rate4));
  revalidatePath("/", "layout");
  return { success: `Saved. ${currency} is now valued at this rate from ${date.split("-").reverse().join("/")}.` };
}

export async function deleteRateAction(fd: FormData): Promise<void> {
  const { db } = await getUserDb();
  await db.exchangeRate.deleteMany({ where: { id: field(fd, "id") } });
  revalidatePath("/", "layout");
}

// ---- Your data: restore a personal backup -------------------------------------------

export async function restoreBackupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose your backup file (.json)." };
  if (file.size > 45 * 1024 * 1024) return { error: "That file is too large." };
  const { scopedDb } = await import("@/lib/db/scoped");
  const { restoreBackup } = await import("@/lib/export/personal");
  const { LedgerError } = await import("@/lib/ledger/engine");
  try {
    const counts = await restoreBackup(scopedDb(prisma, user.id), user.id, await file.text());
    await audit(user.id, "backup_restored", `${counts.entry ?? 0} transactions`);
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  revalidatePath("/", "layout");
  return { success: "Backup restored. Everything is back." };
}

// ---- Admin: whole-app backups on this computer ------------------------------------

export async function backupNowAction(): Promise<FormState> {
  const admin = await requireAdmin();
  const { runBackup } = await import("@/lib/backup/local");
  try {
    const r = await runBackup("Manual (Settings)");
    await audit(admin.id, "backup_made", r.name);
    revalidatePath("/settings");
    if (r.copyError) return { error: `Saved on this computer, but copying to your second folder failed: ${r.copyError}` };
    return { success: r.copiedTo ? "Backup saved on this computer and copied to your second folder." : "Backup saved on this computer." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Backup failed." };
  }
}

export async function setBackupFolderAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const { writeBackupSettings } = await import("@/lib/backup/local");
  const error = await writeBackupSettings(field(fd, "copyDir") || null);
  if (error) return { error };
  await audit(admin.id, "backup_folder_set");
  revalidatePath("/settings");
  return { success: field(fd, "copyDir") ? "Saved. Every backup will also be copied there." : "Second backup folder turned off." };
}

// ---- Admin: users --------------------------------------------------------------------

export async function toggleUserDisabledAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = field(fd, "userId");
  if (id === admin.id) return; // you can't lock yourself out
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;
  const disable = !target.disabledAt;
  await prisma.user.update({ where: { id }, data: { disabledAt: disable ? new Date() : null } });
  if (disable) await prisma.session.deleteMany({ where: { userId: id } }); // signs them out everywhere
  await audit(admin.id, disable ? "user_disabled" : "user_enabled", target.name);
  revalidatePath("/settings");
}
