import type { Account, EntryKind } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate } from "@/lib/format";
import { canPayFrom, ensureDefaultAccounts, isMoneyAccount } from "./accounts";
import { bookValueOut, impliedRate, parseRate, toBase } from "./fx";
import { type ChangeAction, recordChange, snapshotEntry } from "./history";

/**
 * The double-entry engine. Every transaction becomes a list of lines whose
 * amounts add up to exactly zero: money leaving one account (−) arrives in
 * another (+). Nothing that doesn't balance can ever be saved.
 */

export class LedgerError extends Error {}

// Amounts are cents in the money account's own currency. For a foreign-currency account (e.g. USD)
// `rate` says how many of the user's currency one unit buys (e.g. "300.25").
export type EntryInput =
  | {
      kind: "INCOME";
      date: string;
      amount: number;
      categoryId: string;
      accountId: string;
      details?: string | null;
      loanId?: string | null; // e.g. interest from a cheque exchange
      rate?: string | null;
    }
  | {
      kind: "EXPENSE";
      date: string;
      amount: number;
      categoryId: string;
      accountId: string;
      details?: string | null;
      assetId?: string | null; // e.g. a repair linked to the bike
      rate?: string | null;
    }
  // `amount` leaves "from" (its currency); `received` arrives in "to" when the currencies differ.
  | { kind: "TRANSFER"; date: string; amount: number; fromId: string; toId: string; details?: string | null; received?: number | null }
  // Amount may be negative here (e.g. an overdrawn bank account).
  | { kind: "OPENING_BALANCE"; date: string; amount: number; accountId: string; details?: string | null; rate?: string | null };

/** Kinds people enter with the Add form. Asset kinds are managed from the asset page. */
export const FORM_KINDS: EntryKind[] = ["INCOME", "EXPENSE", "TRANSFER", "OPENING_BALANCE"];

// `amount` is always in the user's currency; `foreignAmount` only on lines of a foreign-currency account.
export type Line = { accountId: string; amount: bigint; foreignAmount?: bigint | null };

/** What buildLines needs to know about foreign-currency accounts. */
export type FxContext = {
  openingId?: string;
  currencyOf: (accountId: string) => string | null; // null = the user's own currency
  held: (accountId: string) => { book: bigint; foreign: bigint }; // before this entry
  gainId?: string; // "Exchange gain" (income)
  lossId?: string; // "Exchange loss" (expense)
};

const ZERO = BigInt(0);
const BASE_ONLY: FxContext = { currencyOf: () => null, held: () => ({ book: ZERO, foreign: ZERO }) };

/** Balances lines that don't add to zero with an exchange gain or loss line. */
function withFx(lines: Line[], ctx: FxContext): Line[] {
  const diff = sumLines(lines);
  if (diff === ZERO) return lines;
  if (!ctx.gainId || !ctx.lossId) throw new LedgerError("Exchange gain / loss accounts are missing.");
  // diff > 0: more value arrived than the dollars had cost (gain, shown as income); diff < 0: a loss.
  return [...lines, diff > ZERO ? { accountId: ctx.gainId, amount: -diff } : { accountId: ctx.lossId, amount: -diff }];
}

function needRate(input: { rate?: string | null }) {
  const rate = parseRate(input.rate);
  if (!rate) throw new LedgerError("Enter the exchange rate, e.g. 300.25");
  return rate;
}

function needReceived(input: { received?: number | null }, currency: string | null) {
  if (!input.received || !Number.isSafeInteger(input.received) || input.received <= 0) {
    throw new LedgerError(`Enter the amount received${currency ? ` in ${currency}` : ""}.`);
  }
  return BigInt(input.received);
}

/** A transaction client: the scoped db itself, or the `tx` inside db.$transaction. */
export type Tx = Parameters<Parameters<UserDb["$transaction"]>[0]>[0];

/**
 * Turns a form into balanced lines. Pure function: no database.
 * Foreign-currency accounts: money coming in is valued at the given rate; money going out
 * leaves at what those dollars had cost (average rate), and any difference from what it was
 * worth is an exchange gain or loss.
 */
export function buildLines(input: EntryInput, ctx: FxContext = BASE_ONLY): Line[] {
  const amt = BigInt(input.amount);
  const cur = ctx.currencyOf;
  switch (input.kind) {
    case "INCOME": {
      if (!cur(input.accountId)) {
        return [
          { accountId: input.categoryId, amount: -amt },
          { accountId: input.accountId, amount: amt },
        ];
      }
      const base = toBase(amt, needRate(input));
      return [
        { accountId: input.categoryId, amount: -base },
        { accountId: input.accountId, amount: base, foreignAmount: amt },
      ];
    }
    case "EXPENSE": {
      if (!cur(input.accountId)) {
        return [
          { accountId: input.accountId, amount: -amt },
          { accountId: input.categoryId, amount: amt },
        ];
      }
      const rate = needRate(input);
      const book = bookValueOut(ctx.held(input.accountId), amt, rate);
      return withFx(
        [
          { accountId: input.accountId, amount: -book, foreignAmount: -amt },
          { accountId: input.categoryId, amount: toBase(amt, rate) },
        ],
        ctx,
      );
    }
    case "TRANSFER": {
      const from = cur(input.fromId);
      const to = cur(input.toId);
      if (!from && !to) {
        return [
          { accountId: input.fromId, amount: -amt },
          { accountId: input.toId, amount: amt },
        ];
      }
      if (!from) {
        // Buying foreign currency: the dollars cost what was paid for them.
        const received = needReceived(input, to);
        return [
          { accountId: input.fromId, amount: -amt },
          { accountId: input.toId, amount: amt, foreignAmount: received },
        ];
      }
      const held = ctx.held(input.fromId);
      if (!to) {
        // Converting back: the difference between what arrived and what the dollars cost is a gain or loss.
        const received = needReceived(input, null);
        const book = bookValueOut(held, amt, impliedRate(received, amt));
        return withFx(
          [
            { accountId: input.fromId, amount: -book, foreignAmount: -amt },
            { accountId: input.toId, amount: received },
          ],
          ctx,
        );
      }
      // Between two foreign accounts: their cost moves with them.
      if (held.foreign <= ZERO) throw new LedgerError(`There's no ${from} in the account to move.`);
      const book = bookValueOut(held, amt, impliedRate(held.book, held.foreign));
      const received = from === to ? amt : needReceived(input, to);
      return [
        { accountId: input.fromId, amount: -book, foreignAmount: -amt },
        { accountId: input.toId, amount: book, foreignAmount: received },
      ];
    }
    case "OPENING_BALANCE": {
      if (!ctx.openingId) throw new LedgerError("Opening Balances account is missing.");
      if (!cur(input.accountId)) {
        return [
          { accountId: ctx.openingId, amount: -amt },
          { accountId: input.accountId, amount: amt },
        ];
      }
      const base = toBase(amt, needRate(input));
      return [
        { accountId: ctx.openingId, amount: -base },
        { accountId: input.accountId, amount: base, foreignAmount: amt },
      ];
    }
  }
}

/** The rate a transaction used for a foreign account (to remember it), or null. */
export function rateUsed(input: EntryInput, ctx: Pick<FxContext, "currencyOf">): { currency: string; rate4: bigint } | null {
  if (input.kind === "TRANSFER") {
    const from = ctx.currencyOf(input.fromId);
    const to = ctx.currencyOf(input.toId);
    if (!input.received || (from && to) || (!from && !to)) return null;
    return from
      ? { currency: from, rate4: impliedRate(BigInt(input.received), BigInt(input.amount)) }
      : { currency: to!, rate4: impliedRate(BigInt(input.amount), BigInt(input.received)) };
  }
  const currency = ctx.currencyOf(input.accountId);
  const rate4 = parseRate(input.rate);
  return currency && rate4 ? { currency, rate4 } : null;
}

export function sumLines(lines: Line[]) {
  return lines.reduce((total, l) => total + l.amount, BigInt(0));
}

export function assertBalanced(lines: Line[]) {
  if (lines.length < 2) throw new LedgerError("An entry needs at least two sides.");
  if (sumLines(lines) !== BigInt(0)) throw new LedgerError("Entry does not balance.");
  if (lines.some((l) => l.amount === BigInt(0))) throw new LedgerError("An entry line can't be zero.");
}

/**
 * Low-level: writes one balanced entry. Used by the forms and by the asset
 * register (purchases, depreciation, value changes, sales).
 */
export async function postEntry(
  tx: Tx,
  header: {
    kind: EntryKind;
    date: string;
    details?: string | null;
    assetId?: string | null;
    depMonth?: string | null;
    loanId?: string | null;
    debtId?: string | null;
    importRowId?: string | null; // spreadsheet row it came from
  },
  lines: Line[],
) {
  assertBalanced(lines);
  const entry = await tx.entry.create({
    data: {
      kind: header.kind,
      date: header.date,
      details: header.details?.trim() || null,
      assetId: header.assetId ?? null,
      depMonth: header.depMonth ?? null,
      loanId: header.loanId ?? null,
      debtId: header.debtId ?? null,
      importRowId: header.importRowId ?? null,
    } as never,
  });
  await tx.entryLine.createMany({ data: lines.map((l) => ({ ...l, entryId: entry.id })) as never });
  return entry.id;
}

type Rule = (a: Account) => boolean;
const money: Rule = isMoneyAccount;
const ofType = (type: Account["type"]): Rule => (a) => a.type === type;

/** Checks amount, date, and that each chosen account is the right kind for the form. */
function validate(input: EntryInput, accounts: Map<string, Account>, keepArchived: Set<string>) {
  if (!isIsoDate(input.date)) throw new LedgerError("Choose a valid date.");
  if (!Number.isSafeInteger(input.amount)) throw new LedgerError("Enter a valid amount.");
  if (input.kind === "OPENING_BALANCE" ? input.amount === 0 : input.amount <= 0) {
    throw new LedgerError("Amount must be more than zero.");
  }
  if (input.details && input.details.length > 500) throw new LedgerError("Details are too long (max 500 characters).");

  const need = (id: string, rule: Rule, label: string) => {
    const account = accounts.get(id);
    if (!account || !rule(account) || account.isSystem) throw new LedgerError(`Choose a valid ${label}.`);
    if (account.archived && !keepArchived.has(id)) throw new LedgerError(`"${account.name}" is archived.`);
  };

  switch (input.kind) {
    case "INCOME":
      need(input.categoryId, ofType("INCOME"), "income category");
      need(input.accountId, money, "account to receive the money");
      break;
    case "EXPENSE":
      need(input.categoryId, ofType("EXPENSE"), "expense category");
      need(input.accountId, canPayFrom, "account to pay from");
      break;
    case "TRANSFER":
      need(input.fromId, money, "account to move money from");
      need(input.toId, money, "account to move money to");
      if (input.fromId === input.toId) throw new LedgerError("Choose two different accounts.");
      break;
    case "OPENING_BALANCE":
      need(input.accountId, money, "account");
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
export async function saveEntry(
  db: UserDb,
  input: EntryInput,
  entryId?: string,
  opts: { importRowId?: string; change?: { action: ChangeAction; summary: string } } = {},
) {
  const ids = accountIds(input);
  const assetId = input.kind === "EXPENSE" ? input.assetId || null : null;
  const loanId = input.kind === "INCOME" ? input.loanId || null : null;
  const [found, opening, existing, asset, loan] = await Promise.all([
    db.account.findMany({ where: { id: { in: ids } } }),
    input.kind === "OPENING_BALANCE" ? db.account.findFirst({ where: { systemKey: "OPENING" } }) : Promise.resolve(null),
    entryId ? db.entry.findUnique({ where: { id: entryId }, include: { lines: true } }) : Promise.resolve(null),
    assetId ? db.fixedAsset.findUnique({ where: { id: assetId } }) : Promise.resolve(null),
    loanId ? db.loan.findUnique({ where: { id: loanId } }) : Promise.resolve(null),
  ]);
  if (entryId && !existing) throw new LedgerError("That transaction no longer exists.");
  if (existing && (!FORM_KINDS.includes(existing.kind) || existing.debtId)) {
    throw new LedgerError(
      existing.debtId ? "This transaction is managed from its card or loan's page." : "This transaction is managed from its asset's page.",
    );
  }
  if (assetId && !asset) throw new LedgerError("Choose a valid asset to link.");
  if (loanId && !loan) throw new LedgerError("Choose a valid loan or investment to link.");

  // When editing, accounts already on the entry may stay even if archived since.
  const keepArchived = new Set(existing?.lines.map((l) => l.accountId) ?? []);
  validate(input, new Map(found.map((a) => [a.id, a])), keepArchived);

  const ctx = await fxContext(db, input, found, existing?.id, opening?.id);
  const lines = buildLines(input, ctx);
  assertBalanced(lines);
  const rate = rateUsed(input, ctx);

  const header = { kind: input.kind as EntryKind, date: input.date, details: input.details, assetId, loanId, importRowId: opts.importRowId };

  return db.$transaction(async (tx) => {
    if (rate) await rememberRate(tx, rate.currency, input.date, rate.rate4);
    if (!existing) {
      const id = await postEntry(tx, header, lines);
      const action = opts.change?.action ?? (opts.importRowId ? "IMPORT" : "CREATE");
      await recordChange(tx, id, action, opts.change?.summary ?? (opts.importRowId ? "Imported from a spreadsheet" : "Added"), null, await snapshotEntry(tx, id));
      return id;
    }
    const before = await snapshotEntry(tx, existing.id);
    // Editing keeps the same transaction (id, "added" time); only its lines are replaced.
    await tx.entry.update({
      where: { id: existing.id },
      data: { kind: header.kind, date: header.date, details: header.details?.trim() || null, assetId, loanId },
    });
    await tx.entryLine.deleteMany({ where: { entryId: existing.id } });
    await tx.entryLine.createMany({ data: lines.map((l) => ({ ...l, entryId: existing.id })) as never });
    await recordChange(tx, existing.id, opts.change?.action ?? "UPDATE", opts.change?.summary ?? "Edited", before, await snapshotEntry(tx, existing.id));
    return existing.id;
  });
}

/**
 * For entries touching a foreign-currency account: each account's currency, what's held in it
 * before this entry (cost and amount, up to its date), and the exchange gain / loss accounts.
 */
async function fxContext(db: UserDb, input: EntryInput, accounts: Account[], excludeEntryId: string | undefined, openingId?: string): Promise<FxContext> {
  const foreign = accounts.filter((a) => a.currency);
  if (foreign.length === 0) return { ...BASE_ONLY, openingId };
  await ensureDefaultAccounts(db); // adds Exchange gain / loss for people set up before they existed
  const [rows, gain, loss] = await Promise.all([
    db.entryLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: foreign.map((a) => a.id) }, entry: { date: { lte: input.date } }, ...(excludeEntryId && { entryId: { not: excludeEntryId } }) },
      _sum: { amount: true, foreignAmount: true },
    }),
    db.account.findFirst({ where: { systemKey: "FX_GAIN" } }),
    db.account.findFirst({ where: { systemKey: "FX_LOSS" } }),
  ]);
  const currency = new Map(accounts.map((a) => [a.id, a.currency ?? null]));
  const held = new Map(rows.map((r) => [r.accountId, { book: r._sum.amount ?? ZERO, foreign: r._sum.foreignAmount ?? ZERO }]));
  return {
    openingId,
    currencyOf: (id) => currency.get(id) ?? null,
    held: (id) => held.get(id) ?? { book: ZERO, foreign: ZERO },
    gainId: gain?.id,
    lossId: loss?.id,
  };
}

/** Keeps the rate a transaction used, so it's offered next time and values the account. */
export async function rememberRate(tx: Tx, currency: string, date: string, rate4: bigint) {
  const existing = await tx.exchangeRate.findFirst({ where: { currency, date } });
  if (existing) await tx.exchangeRate.update({ where: { id: existing.id }, data: { rate4 } });
  else await tx.exchangeRate.create({ data: { currency, date, rate4 } as never });
}

/** Deletes an entry made with the Add form. Asset entries are removed via the asset page. */
export async function deleteEntry(db: UserDb, entryId: string, change?: { action: ChangeAction; summary: string }) {
  const entry = await db.entry.findUnique({ where: { id: entryId } });
  if (!entry) throw new LedgerError("That transaction no longer exists.");
  if (!FORM_KINDS.includes(entry.kind) || entry.debtId) {
    throw new LedgerError(
      entry.debtId ? "This transaction is managed from its card or loan's page." : "This transaction is managed from its asset's page.",
    );
  }
  await db.$transaction(async (tx) => {
    const before = await snapshotEntry(tx, entryId);
    await tx.entry.delete({ where: { id: entryId } });
    await recordChange(tx, entryId, change?.action ?? "DELETE", change?.summary ?? "Deleted", before, null);
  });
}
