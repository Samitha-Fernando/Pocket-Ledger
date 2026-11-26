import type { Account, Entry, EntryKind, EntryLine } from "@/generated/prisma/client";
import { canPayFrom, isMoneyAccount } from "./accounts";
import { formatRate, impliedRate } from "./fx";

export type EntryWithLines = Entry & {
  lines: (EntryLine & { account: Account })[];
  asset?: { name: string } | null; // include it to show the asset a repair is linked to
  loan?: { counterparty: string } | null; // include it to show the loan an interest payment is from
};

/**
 * A transaction in the shape the forms and lists use. `amount` is always cents in the user's
 * own currency; when a foreign-currency account (e.g. USD) is involved the foreign side is in
 * `foreignAmount` / `currency` (and for transfers between currencies `toForeignAmount` / `toCurrency`).
 */
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
  debtId?: string | null; // linked card / loan you owe
  debtName?: string;
  chargeAmount?: number; // interest / fees (an expense) inside a borrowing, payment or charge
  paidByCard?: boolean; // an expense or asset bought on a credit card
  currency?: string; // the money account's currency, when it isn't the user's (transfers: the "from" side)
  foreignAmount?: number; // the amount in that currency (positive)
  toCurrency?: string; // transfers: the "to" account's currency, when it isn't the user's
  toForeignAmount?: number; // transfers: the amount that arrived in that currency
  rate?: string; // the exchange rate used, e.g. "300.25"
  fxGain?: number; // exchange gain (+) or loss (−) recorded with it, in the user's currency
};

type LineWithAccount = EntryLine & { account: Account };
const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/** Foreign-currency details of a money line (empty for the user's own currency). */
function foreignOf(line: LineWithAccount | undefined, baseAmount?: bigint) {
  if (!line?.account.currency || line.foreignAmount === null || line.foreignAmount === undefined) return {};
  const value = baseAmount ?? line.amount;
  return {
    currency: line.account.currency,
    foreignAmount: Number(abs(line.foreignAmount)),
    rate: line.foreignAmount !== BigInt(0) ? formatRate(abs(impliedRate(value, line.foreignAmount))) : undefined,
  };
}

/** The exchange gain (+) or loss (−) inside an entry, if any. */
function fxGainOf(lines: LineWithAccount[]) {
  const fx = lines.filter((l) => l.account.systemKey === "FX_GAIN" || l.account.systemKey === "FX_LOSS");
  return fx.length ? Number(-fx.reduce((s, l) => s + l.amount, BigInt(0))) : undefined;
}

/** Reads the lines of an entry back into "category / account / amount" terms. */
export function describeEntry(entry: EntryWithLines): EntryView {
  const lent = entry.lines.find((l) => l.account.subtype === "LENT");
  const loanName = entry.loan?.counterparty ?? lent?.account.name;
  const owed = entry.lines.find((l) => l.account.type === "LIABILITY");
  const base = {
    id: entry.id,
    kind: entry.kind,
    date: entry.date,
    details: entry.details,
    assetId: entry.assetId,
    loanId: entry.loanId,
    loanName,
    debtId: entry.debtId,
    debtName: owed?.account.name,
  };
  const chargePart = Number(entry.lines.filter((l) => l.account.type === "EXPENSE").reduce((s, l) => s + l.amount, BigInt(0)));
  const incomePart = Number(-entry.lines.filter((l) => l.account.type === "INCOME").reduce((s, l) => s + l.amount, BigInt(0)));
  // Exchange gain / loss lines sit beside the real category; never mistake them for it.
  const byType = (type: Account["type"]) => entry.lines.find((l) => l.account.type === type && l.account.systemKey !== "FX_GAIN" && l.account.systemKey !== "FX_LOSS");
  const fixed = entry.lines.find((l) => l.account.subtype === "FIXED");
  const money = (sign: 1 | -1) =>
    entry.lines.find((l) => isMoneyAccount(l.account) && (sign > 0 ? l.amount > BigInt(0) : l.amount < BigInt(0)));
  // What paid for an expense or asset: cash/bank, or a credit card.
  const payer = entry.lines.find((l) => canPayFrom(l.account) && l.amount < BigInt(0));
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
        ...foreignOf(acc),
      };
    }
    case "EXPENSE": {
      const cat = byType("EXPENSE");
      const acc = payer;
      return {
        ...base,
        assetName,
        amount: Number(cat?.amount ?? 0),
        categoryId: cat?.accountId,
        categoryName: cat?.account.name,
        accountId: acc?.accountId,
        accountName: acc?.account.name,
        paidByCard: acc?.account.type === "LIABILITY",
        // Valued at what it cost that day (the category amount), not at what the dollars had cost.
        ...foreignOf(acc, cat ? -cat.amount : undefined),
        fxGain: fxGainOf(entry.lines),
      };
    }
    case "TRANSFER": {
      const from = money(-1);
      const to = money(1);
      const toForeign = foreignOf(to);
      return {
        ...base,
        amount: Number(to?.amount ?? 0),
        fromId: from?.accountId,
        fromName: from?.account.name,
        toId: to?.accountId,
        toName: to?.account.name,
        // Converting back is valued at what arrived; buying at what was paid.
        ...foreignOf(from, to && !to.account.currency ? -to.amount : undefined),
        toCurrency: toForeign.currency,
        toForeignAmount: toForeign.foreignAmount,
        ...(!from?.account.currency && toForeign.rate && { rate: toForeign.rate }),
        fxGain: fxGainOf(entry.lines),
      };
    }
    case "OPENING_BALANCE": {
      // A starting balance on a money account, or a balance already owed on a card / loan.
      const acc = byType("ASSET") ?? owed;
      const amount = acc?.account.type === "LIABILITY" ? -(acc?.amount ?? BigInt(0)) : (acc?.amount ?? BigInt(0));
      return { ...base, amount: Number(amount), accountId: acc?.accountId, accountName: acc?.account.name, ...foreignOf(acc) };
    }
    case "ASSET_PURCHASE": {
      const from = payer;
      return {
        ...base,
        amount: Number(fixed?.amount ?? 0),
        assetName,
        accountId: from?.accountId,
        accountName: from?.account.name,
        paidByCard: from?.account.type === "LIABILITY",
      };
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
    case "BORROW": {
      const into = money(1);
      return { ...base, amount: Number(-(owed?.amount ?? BigInt(0))), chargeAmount: chargePart, accountId: into?.accountId, accountName: into?.account.name };
    }
    case "DEBT_PAYMENT": {
      const from = money(-1);
      return { ...base, amount: Number(-(from?.amount ?? BigInt(0))), chargeAmount: chargePart, accountId: from?.accountId, accountName: from?.account.name };
    }
    case "DEBT_CHARGE":
      return { ...base, amount: chargePart, chargeAmount: chargePart };
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
  BORROW: "Money borrowed",
  DEBT_PAYMENT: "Payment on card / loan",
  DEBT_CHARGE: "Interest / fees charged",
};
