import type { UserDb } from "@/lib/db/scoped";
import { getAccountsWithBalances, isCardAccount, isMoneyAccount } from "./accounts";
import { formatRate, rateOn } from "./fx";
import { LOAN_KINDS } from "./loan-kinds";

export type Option = {
  id: string;
  name: string;
  archived: boolean;
  balance: number; // for a card: what you owe
  isCard?: boolean;
  available?: number | null; // card: credit still available (null = no limit set)
  currency?: string; // foreign-currency account (e.g. USD); balance is then in that currency
  rate?: string; // its latest exchange rate, e.g. "300.25"
};

/** Everything the Add/Edit transaction form needs, as plain serialisable data. */
export async function getFormData(db: UserDb, assetThresholdCents: number) {
  const [accounts, fixedAssets, loans, debts, rules, lastIncome, lastExpense, lastTransfer, rates] = await Promise.all([
    getAccountsWithBalances(db),
    db.fixedAsset.findMany({ select: { id: true, name: true, status: true }, orderBy: { purchaseDate: "desc" } }),
    db.loan.findMany({ select: { id: true, counterparty: true, kind: true, status: true }, orderBy: { startDate: "desc" } }),
    db.debt.findMany({ select: { accountId: true, creditLimit: true } }),
    db.rule.findMany({
      where: { active: true },
      select: { id: true, contains: true, appliesTo: true, categoryId: true, assetId: true, loanId: true, accountId: true },
    }),
    lastLines(db, "INCOME"),
    lastLines(db, "EXPENSE"),
    lastLines(db, "TRANSFER"),
    db.exchangeRate.findMany({ select: { currency: true, date: true, rate4: true } }),
  ]);

  const toOption = (a: (typeof accounts)[number]): Option => ({
    id: a.id,
    name: a.name,
    archived: a.archived,
    balance: Number(a.balance),
  });
  const categories = (type: string) => accounts.filter((a) => a.type === type && !a.isSystem).map(toOption);

  // "Your money" accounts only: cash, bank, savings (not the bike or the phone), in the user's currency.
  // Foreign-currency ones (e.g. USD) are listed apart: only the Add / Edit transaction form uses them.
  const assets = accounts.filter((a) => isMoneyAccount(a) && !a.isSystem && !a.currency).map(toOption);
  const latest = (currency: string) => rateOn(rates, currency, "9999-12-31");
  const foreign = accounts
    .filter((a) => isMoneyAccount(a) && !a.isSystem && a.currency)
    .map((a): Option => {
      const r = latest(a.currency!);
      return { ...toOption(a), currency: a.currency!, balance: Number(a.foreignBalance ?? BigInt(0)), rate: r ? formatRate(r.rate4) : undefined };
    });
  // Credit cards can also pay for expenses and assets.
  const limits = new Map(debts.map((d) => [d.accountId, d.creditLimit]));
  const cards = accounts
    .filter((a) => isCardAccount(a))
    .map((a): Option => {
      const limit = limits.get(a.id);
      return { ...toOption(a), isCard: true, available: limit ? Number(limit - a.balance) : null };
    });
  const payFrom = [...assets, ...cards];
  const assetIds = new Set(payFrom.map((a) => a.id));
  const assetLine = (lines: { accountId: string; amount: bigint }[] | undefined, sign: 1 | -1) =>
    lines?.find((l) => assetIds.has(l.accountId) && (sign > 0 ? l.amount > BigInt(0) : l.amount < BigInt(0)))?.accountId;

  return {
    assets,
    payFrom,
    foreign,
    incomeCategories: categories("INCOME"),
    expenseCategories: categories("EXPENSE"),
    // For linking a repair to the thing it was for.
    fixedAssets: fixedAssets.map((a) => ({ id: a.id, name: a.name, active: a.status === "ACTIVE" })),
    // For linking interest received to the loan / deposit it came from.
    loans: loans.map((l) => ({
      id: l.id,
      name: `${l.counterparty} (${LOAN_KINDS[l.kind as keyof typeof LOAN_KINDS]?.label.toLowerCase() ?? "loan"})`,
      active: l.status === "ACTIVE",
    })),
    assetThreshold: assetThresholdCents,
    // Rules are suggested (never applied silently) when the details match.
    rules,
    // The account used last time for each form, so it's pre-selected next time.
    defaults: {
      incomeAccountId: assetLine(lastIncome, 1),
      expenseAccountId: assetLine(lastExpense, -1),
      transferFromId: assetLine(lastTransfer, -1),
      transferToId: assetLine(lastTransfer, 1),
    },
  };
}

export type LedgerFormData = Awaited<ReturnType<typeof getFormData>>;

async function lastLines(db: UserDb, kind: "INCOME" | "EXPENSE" | "TRANSFER") {
  const entry = await db.entry.findFirst({
    where: { kind },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { lines: true },
  });
  return entry?.lines;
}
