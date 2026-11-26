import type { UserDb } from "@/lib/db/scoped";
import { shiftMonth } from "@/lib/format";
import { monthEnd } from "./assets";
import { LedgerError } from "./engine";
import { type ReportLine, effectiveDate } from "./reports";

/**
 * Monthly budgets, like the "Budget Planning" sheet, and budget vs actual.
 *
 * Budget lines:
 *   ACCOUNT:<id>  an income category, an expense category or a savings account
 *   ASSETS        what you paid for assets you bought
 *   DEBTS         what you paid off cards and loans (interest shows under its expense category)
 */

const ZERO = BigInt(0);

export type BudgetGroup = "INCOME" | "EXPENSE" | "SAVINGS";
export type BudgetLine = { key: string; label: string; group: BudgetGroup };

export const ASSETS_KEY = "ASSETS";
export const DEBTS_KEY = "DEBTS";
export const accountKey = (id: string) => `ACCOUNT:${id}`;

/** All budget lines for this user, in a sensible order. */
export async function getBudgetLines(db: UserDb): Promise<BudgetLine[]> {
  const accounts = await db.account.findMany({
    where: { archived: false, isSystem: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const of = (pick: (a: (typeof accounts)[number]) => boolean, group: BudgetGroup) =>
    accounts.filter(pick).map((a) => ({ key: accountKey(a.id), label: a.name, group }));
  return [
    ...of((a) => a.type === "INCOME", "INCOME"),
    ...of((a) => a.type === "EXPENSE", "EXPENSE"),
    { key: ASSETS_KEY, label: "Asset purchases", group: "EXPENSE" },
    { key: DEBTS_KEY, label: "Debt payments", group: "EXPENSE" },
    ...of((a) => a.type === "ASSET" && a.subtype === "SAVINGS", "SAVINGS"),
  ];
}

export function monthsOfYear(year: number) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** Budgets for some months as key → month → cents. */
export async function getBudgets(db: UserDb, months: string[]) {
  const rows = await db.budget.findMany({ where: { month: { in: months } } });
  const out = new Map<string, Map<string, bigint>>();
  for (const r of rows) {
    if (!out.has(r.lineKey)) out.set(r.lineKey, new Map());
    out.get(r.lineKey)!.set(r.month, r.amount);
  }
  return out;
}

function checkMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new LedgerError("Choose a valid month.");
}

async function checkKey(db: UserDb, key: string) {
  if (key === ASSETS_KEY || key === DEBTS_KEY) return;
  const id = key.startsWith("ACCOUNT:") ? key.slice(8) : "";
  const a = id ? await db.account.findUnique({ where: { id } }) : null;
  const ok = a && !a.isSystem && (a.type === "INCOME" || a.type === "EXPENSE" || (a.type === "ASSET" && a.subtype === "SAVINGS"));
  if (!ok) throw new LedgerError("That budget line no longer exists.");
}

/** Sets (or clears, with null / 0) one month's budget for one line. */
export async function setBudget(db: UserDb, month: string, key: string, cents: number | null) {
  checkMonth(month);
  await checkKey(db, key);
  if (cents === null || cents === 0) {
    await db.budget.deleteMany({ where: { month, lineKey: key } });
    return;
  }
  if (!Number.isSafeInteger(cents) || cents < 0) throw new LedgerError("A budget can't be negative.");
  // (Find then update/create: the user-scoped client adds the owner to every query.)
  const existing = await db.budget.findFirst({ where: { month, lineKey: key } });
  if (existing) await db.budget.update({ where: { id: existing.id }, data: { amount: BigInt(cents) } });
  else await db.budget.create({ data: { month, lineKey: key, amount: BigInt(cents) } as never });
}

/** "Same every month": the same amount for all 12 months of a year. */
export async function fillYear(db: UserDb, year: number, key: string, cents: number | null) {
  for (const m of monthsOfYear(year)) await setBudget(db, m, key, cents);
}

/** Copies every line from one month to another (replacing what's there). */
export async function copyMonth(db: UserDb, from: string, to: string) {
  checkMonth(from);
  checkMonth(to);
  const source = await db.budget.findMany({ where: { month: from } });
  await db.$transaction(async (tx) => {
    await tx.budget.deleteMany({ where: { month: to } });
    if (source.length) await tx.budget.createMany({ data: source.map((b) => ({ month: to, lineKey: b.lineKey, amount: b.amount })) as never });
  });
  return source.length;
}

/** Copies a whole year's budget to another year (replacing what's there). */
export async function copyYear(db: UserDb, from: number, to: number) {
  let count = 0;
  for (let i = 0; i < 12; i++) count += await copyMonth(db, monthsOfYear(from)[i], monthsOfYear(to)[i]);
  return count;
}

// ---- Actuals ---------------------------------------------------------------------

/** What actually happened per budget line in a range of months. Pure. */
export function actuals(lines: ReportLine[], from: string, to: string, lateIncomeDay: number | null) {
  const out = new Map<string, bigint>();
  const add = (key: string, v: bigint) => out.set(key, (out.get(key) ?? ZERO) + v);
  for (const l of lines) {
    const d = effectiveDate(l, lateIncomeDay);
    if (d < from || d > to) continue;
    if (l.type === "INCOME") add(accountKey(l.accountId), -l.amount);
    else if (l.type === "EXPENSE") add(accountKey(l.accountId), l.amount);
    else if (l.kind === "TRANSFER" && l.subtype === "SAVINGS") add(accountKey(l.accountId), l.amount);
    // Income kept in a foreign-currency savings account (e.g. a USD salary) counts toward that savings line.
    else if (l.kind === "INCOME" && l.subtype === "SAVINGS" && l.currency) add(accountKey(l.accountId), l.amount);
    else if (l.kind === "ASSET_PURCHASE" && l.subtype === "FIXED") add(ASSETS_KEY, l.amount);
    else if (l.kind === "DEBT_PAYMENT" && l.type === "LIABILITY") add(DEBTS_KEY, l.amount);
  }
  return out;
}

export type BudgetRow = BudgetLine & {
  budget: bigint;
  actual: bigint;
  remaining: bigint; // budget − actual (for income: what's still expected)
  percent: number | null; // actual ÷ budget × 100
  status: "none" | "under" | "near" | "over";
};

/** Budget vs actual for every line over a range of months. Pure. */
export function compare(lineList: BudgetLine[], budgets: Map<string, Map<string, bigint>>, months: string[], actual: Map<string, bigint>): BudgetRow[] {
  return lineList.map((line) => {
    const budget = months.reduce((s, m) => s + (budgets.get(line.key)?.get(m) ?? ZERO), ZERO);
    const done = actual.get(line.key) ?? ZERO;
    const percent = budget > ZERO ? Number((done * BigInt(1000)) / budget) / 10 : null;
    // Only spending can be "over budget"; more income or savings than planned is fine.
    const status: BudgetRow["status"] =
      budget === ZERO ? "none" : line.group !== "EXPENSE" ? "under" : percent! > 100 ? "over" : percent! >= 90 ? "near" : "under";
    return { ...line, budget, actual: done, remaining: budget - done, percent, status };
  });
}

/** Totals per group and "to be allocated" (income − expenses − savings), like the sheet. Pure. */
export function totals(rows: BudgetRow[]) {
  const sum = (group: BudgetGroup, pick: "budget" | "actual") => rows.filter((r) => r.group === group).reduce((s, r) => s + r[pick], ZERO);
  const t = {
    income: { budget: sum("INCOME", "budget"), actual: sum("INCOME", "actual") },
    expense: { budget: sum("EXPENSE", "budget"), actual: sum("EXPENSE", "actual") },
    savings: { budget: sum("SAVINGS", "budget"), actual: sum("SAVINGS", "actual") },
  };
  return {
    ...t,
    toBeAllocated: t.income.budget - t.expense.budget - t.savings.budget,
    leftActual: t.income.actual - t.expense.actual - t.savings.actual,
  };
}

/** Months covered by a date range ("YYYY-MM"). */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export { monthEnd };
