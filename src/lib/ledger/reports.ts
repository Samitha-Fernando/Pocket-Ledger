import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate, shiftMonth } from "@/lib/format";
import { monthEnd } from "./assets";
import { getDebts } from "./debts";
import { getLoans } from "./loans";

/**
 * Dashboard & reports. Everything is worked out from the ledger lines, so the
 * numbers always agree with History. The "late income shift" (income on or
 * after day N counts toward the next month) applies here only.
 */

const ZERO = BigInt(0);

// ---- Periods -----------------------------------------------------------------

export const PERIODS = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-12": "Last 12 months",
  custom: "Custom",
} as const;
export type PeriodKey = keyof typeof PERIODS;
export type Period = { key: PeriodKey; from: string; to: string };

export function parsePeriod(params: Record<string, string | string[] | undefined>, today: string): Period {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const key = (one("period") in PERIODS ? one("period") : "this-month") as PeriodKey;
  const month = today.slice(0, 7);
  switch (key) {
    case "last-month": {
      const m = shiftMonth(month, -1);
      return { key, from: `${m}-01`, to: monthEnd(m) };
    }
    case "this-year":
      return { key, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "last-12":
      return { key, from: `${shiftMonth(month, -11)}-01`, to: monthEnd(month) };
    case "custom": {
      const from = isIsoDate(one("from")) ? one("from") : `${month}-01`;
      const to = isIsoDate(one("to")) && one("to") >= from ? one("to") : monthEnd(month);
      return { key, from, to };
    }
    default:
      return { key: "this-month", from: `${month}-01`, to: monthEnd(month) };
  }
}

/** The period just before, of the same length in whole months (or days for custom). */
export function previousPeriod(p: Period): { from: string; to: string } {
  const months = (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1;
  const fullMonths = p.from.endsWith("-01") && p.to === monthEnd(p.to.slice(0, 7));
  if (fullMonths) {
    const start = shiftMonth(p.from.slice(0, 7), -months);
    return { from: `${start}-01`, to: monthEnd(shiftMonth(p.to.slice(0, 7), -months)) };
  }
  const day = 86_400_000;
  const a = new Date(`${p.from}T00:00:00Z`).getTime();
  const b = new Date(`${p.to}T00:00:00Z`).getTime();
  const len = Math.round((b - a) / day) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(a - len * day), to: iso(a - day) };
}

/** The 12 months ending with the period's last month ("YYYY-MM"). */
export function trendMonths(p: Period, count = 12) {
  const last = p.to.slice(0, 7);
  return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

// ---- Lines -------------------------------------------------------------------

export type ReportLine = {
  date: string;
  kind: string;
  amount: bigint;
  accountId: string;
  type: string; // account type
  subtype: string | null;
  systemKey: string | null;
  name: string;
};

/** Every ledger line up to a date, with the bits reports need. */
export async function getReportLines(db: UserDb, upTo: string): Promise<ReportLine[]> {
  const lines = await db.entryLine.findMany({
    where: { entry: { date: { lte: upTo } } },
    select: {
      amount: true,
      accountId: true,
      entry: { select: { date: true, kind: true } },
      account: { select: { type: true, subtype: true, systemKey: true, name: true } },
    },
  });
  return lines.map((l) => ({
    date: l.entry.date,
    kind: l.entry.kind,
    amount: l.amount,
    accountId: l.accountId,
    type: l.account.type,
    subtype: l.account.subtype,
    systemKey: l.account.systemKey,
    name: l.account.name,
  }));
}

/**
 * The date a line counts on in reports. With the late income shift (day N),
 * income on or after day N counts on the 1st of the next month. Pure.
 */
export function effectiveDate(line: Pick<ReportLine, "date" | "type">, lateIncomeDay: number | null) {
  if (!lateIncomeDay || line.type !== "INCOME") return line.date;
  if (Number(line.date.slice(8, 10)) < lateIncomeDay) return line.date;
  return `${shiftMonth(line.date.slice(0, 7), 1)}-01`;
}

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export type Flows = {
  income: bigint;
  expenses: bigint; // includes depreciation
  depreciation: bigint;
  movedToSavings: bigint; // net transfers into savings accounts
};

/** Income, expenses and money moved to savings within a date range. Pure. */
export function flows(lines: ReportLine[], from: string, to: string, lateIncomeDay: number | null): Flows {
  const out: Flows = { income: ZERO, expenses: ZERO, depreciation: ZERO, movedToSavings: ZERO };
  for (const l of lines) {
    if (!inRange(effectiveDate(l, lateIncomeDay), from, to)) continue;
    if (l.type === "INCOME") out.income -= l.amount;
    else if (l.type === "EXPENSE") {
      out.expenses += l.amount;
      if (l.systemKey === "DEPRECIATION") out.depreciation += l.amount;
    } else if (l.kind === "TRANSFER" && l.subtype === "SAVINGS") out.movedToSavings += l.amount;
  }
  return out;
}

/** "Kept" savings rate: (income − expenses) ÷ income, as a % (null when no income). Pure. */
export function keptRate(f: Pick<Flows, "income" | "expenses">) {
  return f.income > ZERO ? Number(((f.income - f.expenses) * BigInt(10_000)) / f.income) / 100 : null;
}

/** "Moved to savings" rate, like the spreadsheet: savings ÷ income, as a % (null when no income). Pure. */
export function movedRate(f: Pick<Flows, "income" | "movedToSavings">) {
  return f.income > ZERO ? Number((f.movedToSavings * BigInt(10_000)) / f.income) / 100 : null;
}

/** Net worth (what you own − what you owe) at the end of a date. Pure. */
export function netWorthAt(lines: ReportLine[], date: string) {
  let total = ZERO;
  for (const l of lines) if (l.date <= date && (l.type === "ASSET" || l.type === "LIABILITY")) total += l.amount;
  return total;
}

/** Month-by-month income, expenses, savings rate and month-end net worth. Pure. */
export function monthlySeries(lines: ReportLine[], months: string[], lateIncomeDay: number | null) {
  // Net worth: running total of asset & liability lines, sorted once.
  const balanceLines = lines.filter((l) => l.type === "ASSET" || l.type === "LIABILITY").sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  let running = ZERO;
  return months.map((month) => {
    const end = monthEnd(month);
    while (i < balanceLines.length && balanceLines[i].date <= end) running += balanceLines[i++].amount;
    const f = flows(lines, `${month}-01`, end, lateIncomeDay);
    return { month, ...f, netWorth: running, kept: keptRate(f), moved: movedRate(f) };
  });
}

/** Biggest expense categories in a range, with the previous range for comparison. Pure. */
export function topCategories(lines: ReportLine[], range: { from: string; to: string }, prev: { from: string; to: string }, limit = 8) {
  const sum = (from: string, to: string) => {
    const m = new Map<string, { id: string; name: string; amount: bigint }>();
    for (const l of lines) {
      if (l.type !== "EXPENSE" || !inRange(l.date, from, to)) continue;
      const row = m.get(l.accountId) ?? { id: l.accountId, name: l.name, amount: ZERO };
      row.amount += l.amount;
      m.set(l.accountId, row);
    }
    return m;
  };
  const now = sum(range.from, range.to);
  const before = sum(prev.from, prev.to);
  const total = [...now.values()].reduce((s, r) => s + r.amount, ZERO);
  return [...now.values()]
    .filter((r) => r.amount > ZERO)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, limit)
    .map((r) => {
      const prevAmount = before.get(r.id)?.amount ?? ZERO;
      return {
        ...r,
        share: total > ZERO ? Number((r.amount * BigInt(10_000)) / total) / 100 : 0,
        prevAmount,
        change: prevAmount > ZERO ? Number(((r.amount - prevAmount) * BigInt(10_000)) / prevAmount) / 100 : null,
      };
    });
}

// ---- Coming up ---------------------------------------------------------------

export type UpcomingItem = {
  kind: "loan" | "debt";
  id: string;
  name: string;
  date: string;
  amount: bigint;
  overdue: boolean;
  note: string;
};

/** Loans due back and card / loan payments due in the next `days` days (overdue first). */
export async function getUpcoming(db: UserDb, today: string, days = 30): Promise<UpcomingItem[]> {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  const [loans, debts] = await Promise.all([getLoans(db, today), getDebts(db, today)]);

  const items: UpcomingItem[] = [
    ...loans
      .filter((l) => l.loan.status === "ACTIVE" && l.out > ZERO && l.loan.dueDate && (l.overdue || l.loan.dueDate <= until))
      .map((l) => ({
        kind: "loan" as const,
        id: l.loan.id,
        name: l.loan.counterparty,
        date: l.loan.dueDate!,
        amount: l.out,
        overdue: l.overdue,
        note: l.overdue ? "Overdue: money due back to you" : "Due back to you",
      })),
    ...debts
      .filter((d) => d.debt.status === "ACTIVE" && d.owed > ZERO && d.nextDue && (d.overdue || d.nextDue <= until))
      .map((d) => ({
        kind: "debt" as const,
        id: d.debt.id,
        name: d.debt.name,
        date: d.nextDue!,
        amount: d.debt.monthlyPayment && d.debt.monthlyPayment < d.owed ? d.debt.monthlyPayment : d.owed,
        overdue: d.overdue,
        note: d.overdue ? "Payment missed" : d.isCard ? "Card payment due" : "Instalment due",
      })),
  ];
  return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date));
}
