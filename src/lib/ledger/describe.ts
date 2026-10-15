import type { Account, Entry, EntryKind, EntryLine } from "@/generated/prisma/client";
import { isMoneyAccount } from "./accounts";

export type EntryWithLines = Entry & {
  lines: (EntryLine & { account: Account })[];
  asset?: { name: string } | null; // include it to show the asset a repair is linked to
  loan?: { counterparty: string } | null; // include it to show the loan an interest payment is from
};

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
  assetId?: string | null; // linked asset (purchase, depreciation, value change, sale, repair)
  assetName?: string;
  loanId?: string | null; // linked loan / investment
  loanName?: string;
  interestAmount?: number; // interest part of a lend (kept up front) or money-back entry
};

/** Reads the lines of an entry back into "category / account / amount" terms. */
export function describeEntry(entry: EntryWithLines): EntryView {
  const lent = entry.lines.find((l) => l.account.subtype === "LENT");
  const loanName = entry.loan?.counterparty ?? lent?.account.name;
  const base = {
    id: entry.id,
    kind: entry.kind,
    date: entry.date,
    details: entry.details,
    assetId: entry.assetId,
    loanId: entry.loanId,
    loanName,
  };
  const incomePart = Number(-entry.lines.filter((l) => l.account.type === "INCOME").reduce((s, l) => s + l.amount, BigInt(0)));
  const byType = (type: Account["type"]) => entry.lines.find((l) => l.account.type === type);
  const fixed = entry.lines.find((l) => l.account.subtype === "FIXED");
  const money = (sign: 1 | -1) =>
    entry.lines.find((l) => isMoneyAccount(l.account) && (sign > 0 ? l.amount > BigInt(0) : l.amount < BigInt(0)));
  const assetName = fixed?.account.name ?? entry.asset?.name;

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
      const acc = money(-1);
      return {
        ...base,
        assetName,
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
    case "ASSET_PURCHASE": {
      const from = money(-1);
      return { ...base, amount: Number(fixed?.amount ?? 0), assetName, accountId: from?.accountId, accountName: from?.account.name };
    }
    case "DEPRECIATION":
      // Shown as the value lost (positive).
      return { ...base, amount: Number(-(fixed?.amount ?? BigInt(0))), assetName };
    case "ASSET_REVALUATION":
      // Positive = value went up, negative = went down.
      return { ...base, amount: Number(fixed?.amount ?? 0), assetName };
    case "ASSET_SALE": {
      const into = money(1);
      return { ...base, amount: Number(into?.amount ?? 0), assetName, accountId: into?.accountId, accountName: into?.account.name };
    }
    case "LEND": {
      const from = money(-1);
      return { ...base, amount: Number(lent?.amount ?? 0), interestAmount: incomePart, accountId: from?.accountId, accountName: from?.account.name };
    }
    case "LOAN_RETURN": {
      const into = money(1);
      return { ...base, amount: Number(into?.amount ?? 0), interestAmount: incomePart, accountId: into?.accountId, accountName: into?.account.name };
    }
    case "LOAN_WRITE_OFF":
      return { ...base, amount: Number(-(lent?.amount ?? BigInt(0))) };
  }
}

export const KIND_LABELS: Record<EntryKind, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  OPENING_BALANCE: "Opening balance",
  ASSET_PURCHASE: "Asset purchase",
  DEPRECIATION: "Depreciation",
  ASSET_REVALUATION: "Asset value change",
  ASSET_SALE: "Asset sale",
  LEND: "Money lent",
  LOAN_RETURN: "Money received back",
  LOAN_WRITE_OFF: "Written off",
};
