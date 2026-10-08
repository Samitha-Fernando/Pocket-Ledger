import type { UserDb } from "@/lib/db/scoped";
import { getAccountsWithBalances } from "./accounts";

export type Option = { id: string; name: string; archived: boolean; balance: number };

/** Everything the Add/Edit transaction form needs, as plain serialisable data. */
export async function getFormData(db: UserDb) {
  const [accounts, lastIncome, lastExpense, lastTransfer] = await Promise.all([
    getAccountsWithBalances(db),
    lastLines(db, "INCOME"),
    lastLines(db, "EXPENSE"),
    lastLines(db, "TRANSFER"),
  ]);

  const pick = (type: string): Option[] =>
    accounts
      .filter((a) => a.type === type && !a.isSystem)
      .map((a) => ({ id: a.id, name: a.name, archived: a.archived, balance: Number(a.balance) }));

  const assets = pick("ASSET");
  const assetIds = new Set(assets.map((a) => a.id));
  const assetLine = (lines: { accountId: string; amount: bigint }[] | undefined, sign: 1 | -1) =>
    lines?.find((l) => assetIds.has(l.accountId) && (sign > 0 ? l.amount > BigInt(0) : l.amount < BigInt(0)))?.accountId;

  return {
    assets,
    incomeCategories: pick("INCOME"),
    expenseCategories: pick("EXPENSE"),
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
