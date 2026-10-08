import type { Account, EntryKind } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate } from "@/lib/format";

/**
 * The double-entry engine. Every form becomes a list of lines whose amounts
 * add up to exactly zero: money leaving one account (−) arrives in another (+).
 * Nothing that doesn't balance can ever be saved.
 */

export class LedgerError extends Error {}

export type EntryInput =
  | { kind: "INCOME"; date: string; amount: number; categoryId: string; accountId: string; details?: string | null }
  | { kind: "EXPENSE"; date: string; amount: number; categoryId: string; accountId: string; details?: string | null }
  | { kind: "TRANSFER"; date: string; amount: number; fromId: string; toId: string; details?: string | null }
  // Amount may be negative here (e.g. an overdrawn bank account).
  | { kind: "OPENING_BALANCE"; date: string; amount: number; accountId: string; details?: string | null };

export type Line = { accountId: string; amount: bigint };

/** Turns a form into balanced lines. Pure function: no database. */
export function buildLines(input: EntryInput, openingBalancesId?: string): Line[] {
  const amt = BigInt(input.amount);
  switch (input.kind) {
    case "INCOME":
      return [
        { accountId: input.categoryId, amount: -amt },
        { accountId: input.accountId, amount: amt },
      ];
    case "EXPENSE":
      return [
        { accountId: input.accountId, amount: -amt },
        { accountId: input.categoryId, amount: amt },
      ];
    case "TRANSFER":
      return [
        { accountId: input.fromId, amount: -amt },
        { accountId: input.toId, amount: amt },
      ];
    case "OPENING_BALANCE":
      if (!openingBalancesId) throw new LedgerError("Opening Balances account is missing.");
      return [
        { accountId: openingBalancesId, amount: -amt },
        { accountId: input.accountId, amount: amt },
      ];
  }
}

export function sumLines(lines: Line[]) {
  return lines.reduce((total, l) => total + l.amount, BigInt(0));
}

export function assertBalanced(lines: Line[]) {
  if (lines.length < 2) throw new LedgerError("An entry needs at least two sides.");
  if (sumLines(lines) !== BigInt(0)) throw new LedgerError("Entry does not balance.");
  if (lines.some((l) => l.amount === BigInt(0))) throw new LedgerError("An entry line can't be zero.");
}

/** Checks amount, date, and that each chosen account is the right kind for the form. */
function validate(input: EntryInput, accounts: Map<string, Account>, keepArchived: Set<string>) {
  if (!isIsoDate(input.date)) throw new LedgerError("Choose a valid date.");
  if (!Number.isSafeInteger(input.amount)) throw new LedgerError("Enter a valid amount.");
  if (input.kind === "OPENING_BALANCE" ? input.amount === 0 : input.amount <= 0) {
    throw new LedgerError("Amount must be more than zero.");
  }
  if (input.details && input.details.length > 500) throw new LedgerError("Details are too long (max 500 characters).");

  const need = (id: string, types: Account["type"][], label: string) => {
    const account = accounts.get(id);
    if (!account || !types.includes(account.type) || account.isSystem) throw new LedgerError(`Choose a valid ${label}.`);
    if (account.archived && !keepArchived.has(id)) throw new LedgerError(`"${account.name}" is archived.`);
  };

  switch (input.kind) {
    case "INCOME":
      need(input.categoryId, ["INCOME"], "income category");
      need(input.accountId, ["ASSET"], "account to receive the money");
      break;
    case "EXPENSE":
      need(input.categoryId, ["EXPENSE"], "expense category");
      need(input.accountId, ["ASSET"], "account to pay from");
      break;
    case "TRANSFER":
      need(input.fromId, ["ASSET"], "account to move money from");
      need(input.toId, ["ASSET"], "account to move money to");
      if (input.fromId === input.toId) throw new LedgerError("Choose two different accounts.");
      break;
    case "OPENING_BALANCE":
      need(input.accountId, ["ASSET"], "account");
      break;
  }
}

function accountIds(input: EntryInput) {
  switch (input.kind) {
    case "INCOME":
    case "EXPENSE":
      return [input.categoryId, input.accountId];
    case "TRANSFER":
      return [input.fromId, input.toId];
    case "OPENING_BALANCE":
      return [input.accountId];
  }
}

/**
 * Creates a new entry, or replaces an existing one (when `entryId` is given).
 * `db` is the user-scoped client, so only the user's own accounts are visible:
 * an account id belonging to someone else is simply "not found".
 */
export async function saveEntry(db: UserDb, input: EntryInput, entryId?: string) {
  const ids = accountIds(input);
  const [found, opening, existing] = await Promise.all([
    db.account.findMany({ where: { id: { in: ids } } }),
    input.kind === "OPENING_BALANCE"
      ? db.account.findFirst({ where: { type: "EQUITY", isSystem: true } })
      : Promise.resolve(null),
    entryId ? db.entry.findUnique({ where: { id: entryId }, include: { lines: true } }) : Promise.resolve(null),
  ]);
  if (entryId && !existing) throw new LedgerError("That transaction no longer exists.");

  // When editing, accounts already on the entry may stay even if archived since.
  const keepArchived = new Set(existing?.lines.map((l) => l.accountId) ?? []);
  validate(input, new Map(found.map((a) => [a.id, a])), keepArchived);

  const lines = buildLines(input, opening?.id);
  assertBalanced(lines);

  const data = { kind: input.kind as EntryKind, date: input.date, details: input.details?.trim() || null };

  return db.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await tx.entry.update({ where: { id: existing.id }, data });
      await tx.entryLine.deleteMany({ where: { entryId: existing.id } });
      id = existing.id;
    } else {
      id = (await tx.entry.create({ data: data as never })).id;
    }
    await tx.entryLine.createMany({ data: lines.map((l) => ({ ...l, entryId: id })) as never });
    return id;
  });
}

export async function deleteEntry(db: UserDb, entryId: string) {
  const { count } = await db.entry.deleteMany({ where: { id: entryId } });
  if (count === 0) throw new LedgerError("That transaction no longer exists.");
}
