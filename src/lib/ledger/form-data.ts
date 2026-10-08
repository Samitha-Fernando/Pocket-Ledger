import type { UserDb } from "@/lib/db/scoped";
import { getAccountsWithBalances, isMoneyAccount } from "./accounts";

export type Option = { id: string; name: string; archived: boolean; balance: number };

/** Everything the Add/Edit transaction form needs, as plain serialisable data. */
export async function getFormData(db: UserDb, assetThresholdCents: number) {
  const [accounts, fixedAssets, lastIncome, lastExpense, lastTransfer] = await Promise.all([
    getAccountsWithBalances(db),
    db.fixedAsset.findMany({ select: { id: true, name: true, status: true }, orderBy: { purchaseDate: "desc" } }),
    lastLines(db, "INCOME"),
    lastLines(db, "EXPENSE"),
    lastLines(db, "TRANSFER"),
  ]);

  const toOption = (a: (typeof accounts)[number]): Option => ({
    id: a.id,
    name: a.name,
    archived: a.archived,
    balance: Number(a.balance),
  });
  const categories = (type: string) => accounts.filter((a) => a.type === type && !a.isSystem).map(toOption);

  // "Your money" accounts only: cash, bank, savings (not the bike or the phone).
  const assets = accounts.filter((a) => isMoneyAccount(a) && !a.isSystem).map(toOption);
  const assetIds = new Set(assets.map((a) => a.id));
  const assetLine = (lines: { accountId: string; amount: bigint }[] | undefined, sign: 1 | -1) =>
    lines?.find((l) => assetIds.has(l.accountId) && (sign > 0 ? l.amount > BigInt(0) : l.amount < BigInt(0)))?.accountId;

  return {
    assets,
    incomeCategories: categories("INCOME"),
    expenseCategories: categories("EXPENSE"),
    // For linking a repair to the thing it was for.
    fixedAssets: fixedAssets.map((a) => ({ id: a.id, name: a.name, active: a.status === "ACTIVE" })),
    assetThreshold: assetThresholdCents,
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
