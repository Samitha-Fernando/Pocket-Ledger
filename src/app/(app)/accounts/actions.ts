"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AccountType } from "@/generated/prisma/client";
import { audit, getLedger } from "@/lib/auth/session";
import { type FormState, field } from "@/lib/auth/validate";
import { ASSET_SUBTYPES } from "@/lib/ledger/accounts";
import { LedgerError, saveEntry } from "@/lib/ledger/engine";
import { isIsoDate, parseMoneyToCents } from "@/lib/format";
import type { UserDb } from "@/lib/db/scoped";

const EDITABLE_TYPES: AccountType[] = ["ASSET", "INCOME", "EXPENSE"];

async function nameTaken(db: UserDb, type: AccountType, name: string, exceptId?: string) {
  const same = await db.account.findMany({ where: { type }, select: { id: true, name: true } });
  return same.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase());
}

function checkName(name: string) {
  if (!name) return "Enter a name.";
  if (name.length > 60) return "Name is too long (max 60 characters).";
  return null;
}

export async function createAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, db } = await getLedger();
  const name = field(fd, "name");
  const type = field(fd, "type") as AccountType;
  const subtype = field(fd, "subtype");

  if (!EDITABLE_TYPES.includes(type)) return { error: "Choose what kind of account this is." };
  const nameError = checkName(name);
  if (nameError) return { error: nameError };
  if (type === "ASSET" && !(subtype in ASSET_SUBTYPES)) return { error: "Choose the account type." };
  if (await nameTaken(db, type, name)) return { error: `You already have "${name}".` };

  // Optional starting balance for "your money" accounts.
  const openingText = field(fd, "openingAmount");
  const openingDate = field(fd, "openingDate");
  const opening = openingText ? parseMoneyToCents(openingText) : 0;
  if (type === "ASSET") {
    if (opening === null) return { error: "Enter a valid starting balance, e.g. 25,000" };
    if (opening !== 0 && !isIsoDate(openingDate)) return { error: "Choose the date of the starting balance." };
  }

  const last = await db.account.findFirst({ where: { type }, orderBy: { sortOrder: "desc" } });
  const account = await db.account.create({
    data: {
      name,
      type,
      subtype: type === "ASSET" ? subtype : null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    } as never,
  });

  if (type === "ASSET" && opening) {
    try {
      await saveEntry(db, { kind: "OPENING_BALANCE", date: openingDate, amount: opening, accountId: account.id });
    } catch (err) {
      await db.account.delete({ where: { id: account.id } });
      if (err instanceof LedgerError) return { error: err.message };
      throw err;
    }
  }

  await audit(user.id, "ledger_account_created", name);
  revalidatePath("/", "layout");
  redirect(`/accounts/${account.id}`);
}

export async function renameAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "id");
  const name = field(fd, "name");
  const account = await db.account.findUnique({ where: { id } });
  if (!account || account.isSystem) return { error: "This account can't be renamed." };
  const nameError = checkName(name);
  if (nameError) return { error: nameError };
  if (await nameTaken(db, account.type, name, id)) return { error: `You already have "${name}".` };

  await db.account.update({ where: { id }, data: { name } });
  await audit(user.id, "ledger_account_renamed", `${account.name} → ${name}`);
  revalidatePath("/", "layout");
  return { success: "Renamed." };
}

export async function setArchived(fd: FormData) {
  const { user, db } = await getLedger();
  const id = field(fd, "id");
  const archived = field(fd, "archived") === "true";
  const account = await db.account.findUnique({ where: { id } });
  if (!account || account.isSystem) return;
  await db.account.update({ where: { id }, data: { archived } });
  await audit(user.id, archived ? "ledger_account_archived" : "ledger_account_unarchived", account.name);
  revalidatePath("/", "layout");
}

/** Deletes an account only if it has never been used. */
export async function deleteAccount(fd: FormData) {
  const { user, db } = await getLedger();
  const id = field(fd, "id");
  const account = await db.account.findUnique({ where: { id } });
  if (!account || account.isSystem) return;
  if ((await db.entryLine.count({ where: { accountId: id } })) > 0) return;
  await db.account.delete({ where: { id } });
  await audit(user.id, "ledger_account_deleted", account.name);
  revalidatePath("/", "layout");
  redirect("/accounts");
}

/** Moves an account one place up or down within its group. */
export async function moveAccount(fd: FormData) {
  const { db } = await getLedger();
  const id = field(fd, "id");
  const direction = field(fd, "direction") === "up" ? -1 : 1;
  const account = await db.account.findUnique({ where: { id } });
  if (!account) return;

  const siblings = await db.account.findMany({
    where: { type: account.type, archived: account.archived },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const index = siblings.findIndex((a) => a.id === id);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return;

  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  await db.$transaction(siblings.map((a, i) => db.account.update({ where: { id: a.id }, data: { sortOrder: i } })));
  revalidatePath("/", "layout");
}
