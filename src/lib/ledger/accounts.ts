import type { AccountType } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";

export const ASSET_SUBTYPES = {
  CASH: "Cash",
  BANK: "Bank account",
  SAVINGS: "Savings",
  OTHER: "Other",
} as const;
export type AssetSubtype = keyof typeof ASSET_SUBTYPES;

export const OPENING_BALANCES_NAME = "Opening Balances";

/** Accounts the app manages itself (people can't post to them by hand). */
export type SystemKey = "OPENING" | "DEPRECIATION" | "ASSET_GAIN" | "ASSET_LOSS" | "BAD_DEBTS";

/** Subtype of the ledger account behind each fixed asset. */
export const FIXED_SUBTYPE = "FIXED";

/** Subtype of the ledger account behind each loan / investment. */
export const LENT_SUBTYPE = "LENT";

/** Subtypes of the liability account behind each card / loan you owe. */
export const CARD_SUBTYPE = "CARD";
export const LOAN_DEBT_SUBTYPE = "LOAN";

type Seed = { name: string; type: AccountType; subtype?: AssetSubtype; systemKey?: SystemKey };

const SYSTEM_ACCOUNTS: Seed[] = [
  { name: "Depreciation", type: "EXPENSE", systemKey: "DEPRECIATION" },
  { name: "Gain on assets", type: "INCOME", systemKey: "ASSET_GAIN" },
  { name: "Loss on assets", type: "EXPENSE", systemKey: "ASSET_LOSS" },
  { name: "Bad debts", type: "EXPENSE", systemKey: "BAD_DEBTS" },
  { name: OPENING_BALANCES_NAME, type: "EQUITY", systemKey: "OPENING" },
];

/** The starting chart of accounts every new user gets. */
export const DEFAULT_ACCOUNTS: Seed[] = [
  { name: "Cash in hand", type: "ASSET", subtype: "CASH" },
  { name: "Bank account", type: "ASSET", subtype: "BANK" },
  { name: "Savings account", type: "ASSET", subtype: "SAVINGS" },
  { name: "AIA Emergency Fund", type: "ASSET", subtype: "SAVINGS" },

  { name: "Employment (Net)", type: "INCOME" },
  { name: "Bank Interest", type: "INCOME" },
  { name: "Cheque Exchange Interest", type: "INCOME" },
  { name: "Side Sales", type: "INCOME" },
  { name: "Other Income", type: "INCOME" },

  { name: "Food", type: "EXPENSE" },
  { name: "Utilities", type: "EXPENSE" },
  { name: "Groceries", type: "EXPENSE" },
  { name: "Transportation", type: "EXPENSE" },
  { name: "Clothing", type: "EXPENSE" },
  { name: "Medicine", type: "EXPENSE" },
  { name: "Body Care", type: "EXPENSE" },
  { name: "Fun & Vacation", type: "EXPENSE" },
  { name: "Gift", type: "EXPENSE" },
  { name: "Gym", type: "EXPENSE" },
  { name: "Education", type: "EXPENSE" },
  { name: "Assets Repairs & Maintenance", type: "EXPENSE" },
  { name: "Interest Paid", type: "EXPENSE" },
  { name: "Other", type: "EXPENSE" },

  ...SYSTEM_ACCOUNTS,
];

const toRow = (a: Seed, i: number) => ({
  name: a.name,
  type: a.type,
  subtype: a.subtype ?? null,
  isSystem: Boolean(a.systemKey),
  systemKey: a.systemKey ?? null,
  sortOrder: 1000 + i,
});

/**
 * Creates the default accounts the first time a user needs them, and adds any
 * app-managed accounts introduced by later versions (e.g. Depreciation).
 */
export async function ensureDefaultAccounts(db: UserDb) {
  const existing = await db.account.findMany({ where: { isSystem: true }, select: { systemKey: true } });
  if (existing.length === 0 && (await db.account.count()) === 0) {
    await db.account.createMany({ data: DEFAULT_ACCOUNTS.map((a, i) => ({ ...toRow(a, i), sortOrder: i })) as never });
    return;
  }
  const have = new Set(existing.map((a) => a.systemKey));
  const missing = SYSTEM_ACCOUNTS.filter((a) => !have.has(a.systemKey!));
  if (missing.length > 0) await db.account.createMany({ data: missing.map(toRow) as never });
}

/** Finds one of the app-managed accounts. */
export async function systemAccount(db: Pick<UserDb, "account">, key: SystemKey) {
  const account = await db.account.findFirst({ where: { systemKey: key } });
  if (!account) throw new Error(`System account ${key} is missing`);
  return account;
}

/** Cash, bank, savings or other "money" account (not a fixed asset or money lent out). */
export function isMoneyAccount(a: { type: AccountType; subtype: string | null }) {
  return a.type === "ASSET" && a.subtype !== FIXED_SUBTYPE && a.subtype !== LENT_SUBTYPE;
}

/** A credit card you can pay for things with. */
export function isCardAccount(a: { type: AccountType; subtype: string | null }) {
  return a.type === "LIABILITY" && a.subtype === CARD_SUBTYPE;
}

/** Accounts you can pay for an expense or asset from: cash/bank/savings or a credit card. */
export function canPayFrom(a: { type: AccountType; subtype: string | null }) {
  return isMoneyAccount(a) || isCardAccount(a);
}

/**
 * Balance shown to people. Lines store money-in as + and money-out as −.
 * For things you own and expenses that is already the natural sign; for
 * income, debts and opening balances it is flipped so they read as positive.
 */
export function naturalBalance(type: AccountType, raw: bigint) {
  return type === "ASSET" || type === "EXPENSE" ? raw : -raw;
}

/** Raw sum of lines per account (optionally within a date range). */
export async function getRawBalances(db: UserDb, range?: { from?: string; to?: string }) {
  const where =
    range && (range.from || range.to)
      ? { entry: { date: { ...(range.from && { gte: range.from }), ...(range.to && { lte: range.to }) } } }
      : {};
  const rows = await db.entryLine.groupBy({ by: ["accountId"], where, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.accountId, r._sum.amount ?? BigInt(0)]));
}

/** All accounts with their natural balances, in display order. */
export async function getAccountsWithBalances(db: UserDb, range?: { from?: string; to?: string }) {
  const [accounts, raw] = await Promise.all([
    db.account.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getRawBalances(db, range),
  ]);
  return accounts.map((a) => ({ ...a, balance: naturalBalance(a.type, raw.get(a.id) ?? BigInt(0)) }));
}

export type AccountWithBalance = Awaited<ReturnType<typeof getAccountsWithBalances>>[number];

export const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Your money",
  LIABILITY: "Money you owe",
  INCOME: "Income category",
  EXPENSE: "Expense category",
  EQUITY: "Opening balances",
};
