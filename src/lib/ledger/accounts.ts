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

type Seed = { name: string; type: AccountType; subtype?: AssetSubtype; isSystem?: boolean };

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

  { name: OPENING_BALANCES_NAME, type: "EQUITY", isSystem: true },
];

/** Creates the default accounts the first time a user needs them. */
export async function ensureDefaultAccounts(db: UserDb) {
  if ((await db.account.count()) > 0) return;
  await db.account.createMany({
    data: DEFAULT_ACCOUNTS.map((a, i) => ({
      name: a.name,
      type: a.type,
      subtype: a.subtype ?? null,
      isSystem: a.isSystem ?? false,
      sortOrder: i,
    })) as never,
  });
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
