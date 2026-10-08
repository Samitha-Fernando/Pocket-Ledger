import type { Account, Entry, EntryKind, EntryLine } from "@/generated/prisma/client";

export type EntryWithLines = Entry & { lines: (EntryLine & { account: Account })[] };

/** A transaction in the shape the forms and lists use (amount in cents). */
export type EntryView = {
  id: string;
  kind: EntryKind;
  date: string;
  details: string | null;
  amount: number;
  categoryId?: string;
  categoryName?: string;
  accountId?: string;
  accountName?: string;
  fromId?: string;
  fromName?: string;
  toId?: string;
  toName?: string;
};

/** Reads the lines of an entry back into "category / account / amount" terms. */
export function describeEntry(entry: EntryWithLines): EntryView {
  const base = { id: entry.id, kind: entry.kind, date: entry.date, details: entry.details };
  const byType = (type: Account["type"]) => entry.lines.find((l) => l.account.type === type);

  switch (entry.kind) {
    case "INCOME": {
      const cat = byType("INCOME");
      const acc = byType("ASSET");
      return {
        ...base,
        amount: Number(acc?.amount ?? 0),
        categoryId: cat?.accountId,
        categoryName: cat?.account.name,
        accountId: acc?.accountId,
        accountName: acc?.account.name,
      };
    }
    case "EXPENSE": {
      const cat = byType("EXPENSE");
      const acc = byType("ASSET");
      return {
        ...base,
        amount: Number(cat?.amount ?? 0),
        categoryId: cat?.accountId,
        categoryName: cat?.account.name,
        accountId: acc?.accountId,
        accountName: acc?.account.name,
      };
    }
    case "TRANSFER": {
      const from = entry.lines.find((l) => l.amount < BigInt(0));
      const to = entry.lines.find((l) => l.amount > BigInt(0));
      return {
        ...base,
        amount: Number(to?.amount ?? 0),
        fromId: from?.accountId,
        fromName: from?.account.name,
        toId: to?.accountId,
        toName: to?.account.name,
      };
    }
    case "OPENING_BALANCE": {
      const acc = byType("ASSET");
      return { ...base, amount: Number(acc?.amount ?? 0), accountId: acc?.accountId, accountName: acc?.account.name };
    }
  }
}

export const KIND_LABELS: Record<EntryKind, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  OPENING_BALANCE: "Opening balance",
};
