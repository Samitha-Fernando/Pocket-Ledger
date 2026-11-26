import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts } from "@/lib/ledger/accounts";
import { createAsset } from "@/lib/ledger/assets";
import { createDebt } from "@/lib/ledger/debts";
import { saveEntry } from "@/lib/ledger/engine";
import { createLoan } from "@/lib/ledger/loans";
import {
  type ReportLine,
  effectiveDate,
  flows,
  getReportLines,
  getUpcoming,
  keptRate,
  monthlySeries,
  movedRate,
  netWorthAt,
  parsePeriod,
  previousPeriod,
  topCategories,
  trendMonths,
} from "@/lib/ledger/reports";
import { resetDb } from "./helpers";

const B = (n: number) => BigInt(n);
const rs = (rupees: number) => rupees * 100;
const TODAY = "2026-10-20";

/** Builds the two lines of a simple entry for pure tests. */
function entry(date: string, kind: string, amount: number, from: Partial<ReportLine>, to: Partial<ReportLine>): ReportLine[] {
  const base = { date, kind, subtype: null, systemKey: null, name: "x", currency: null, foreignAmount: null };
  return [
    { ...base, accountId: "from", type: "ASSET", ...from, amount: B(-amount) },
    { ...base, accountId: "to", type: "EXPENSE", ...to, amount: B(amount) },
  ];
}
const bank = { accountId: "bank", type: "ASSET", subtype: "BANK", name: "Bank" };
const salaryCat = { accountId: "salary", type: "INCOME", name: "Salary" };
const food = { accountId: "food", type: "EXPENSE", name: "Food" };
const dep = { accountId: "dep", type: "EXPENSE", systemKey: "DEPRECIATION", name: "Depreciation" };
const savings = { accountId: "sav", type: "ASSET", subtype: "SAVINGS", name: "Savings" };

describe("periods", () => {
  it("works out common periods and the one before", () => {
    expect(parsePeriod({}, TODAY)).toEqual({ key: "this-month", from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriod({ period: "last-month" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(parsePeriod({ period: "this-year" }, TODAY)).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(parsePeriod({ period: "last-12" }, TODAY)).toMatchObject({ from: "2025-11-01", to: "2026-10-31" });
    expect(parsePeriod({ period: "custom", from: "2026-03-10", to: "2026-03-19" }, TODAY)).toMatchObject({ from: "2026-03-10", to: "2026-03-19" });
    expect(previousPeriod(parsePeriod({}, TODAY))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod(parsePeriod({ period: "this-year" }, TODAY))).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousPeriod({ key: "custom", from: "2026-03-10", to: "2026-03-19" })).toEqual({ from: "2026-02-28", to: "2026-03-09" });
    expect(trendMonths(parsePeriod({}, TODAY))).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });
});

describe("late income shift", () => {
  it("moves income on or after day N to the next month; nothing else moves", () => {
    expect(effectiveDate({ date: "2026-09-25", type: "INCOME" }, 25)).toBe("2026-10-01");
    expect(effectiveDate({ date: "2026-09-24", type: "INCOME" }, 25)).toBe("2026-09-24");
    expect(effectiveDate({ date: "2026-12-28", type: "INCOME" }, 25)).toBe("2027-01-01");
    expect(effectiveDate({ date: "2026-09-25", type: "EXPENSE" }, 25)).toBe("2026-09-25");
    expect(effectiveDate({ date: "2026-09-25", type: "INCOME" }, null)).toBe("2026-09-25");
  });

  it("puts the 25th-of-September salary into October's income", () => {
    // Salary category gives (−), bank receives (+).
    const lines = entry("2026-09-25", "INCOME", rs(185_000), salaryCat, bank);
    expect(flows(lines, "2026-09-01", "2026-09-30", 25).income).toBe(B(0));
    expect(flows(lines, "2026-10-01", "2026-10-31", 25).income).toBe(B(rs(185_000)));
    expect(flows(lines, "2026-09-01", "2026-09-30", null).income).toBe(B(rs(185_000)));
  });
});

describe("flows, savings rates and net worth", () => {
  // Salary 100,000 in; food 30,000 and depreciation 5,000 out; 20,000 moved to savings.
  const lines: ReportLine[] = [
    { date: "2026-10-01", kind: "INCOME", amount: B(rs(-100_000)), subtype: null, systemKey: null, currency: null, foreignAmount: null, ...salaryCat },
    { date: "2026-10-01", kind: "INCOME", amount: B(rs(100_000)), systemKey: null, currency: null, foreignAmount: null, ...bank },
    ...entry("2026-10-05", "EXPENSE", rs(30_000), bank, food),
    ...entry("2026-10-31", "DEPRECIATION", rs(5_000), { accountId: "bike", type: "ASSET", subtype: "FIXED" }, dep),
    ...entry("2026-10-10", "TRANSFER", rs(20_000), bank, savings),
  ];

  it("adds up income, expenses (with depreciation) and money moved to savings", () => {
    const f = flows(lines, "2026-10-01", "2026-10-31", null);
    expect(f).toEqual({ income: B(rs(100_000)), expenses: B(rs(35_000)), depreciation: B(rs(5_000)), movedToSavings: B(rs(20_000)) });
    expect(keptRate(f)).toBe(65); // (100 − 35) ÷ 100
    expect(movedRate(f)).toBe(20); // 20 ÷ 100
    expect(keptRate({ income: B(0), expenses: B(10) })).toBeNull();
  });

  it("net worth only changes with income and expenses, not transfers", () => {
    expect(netWorthAt(lines, "2026-09-30")).toBe(B(0));
    expect(netWorthAt(lines, "2026-10-09")).toBe(B(rs(70_000)));
    expect(netWorthAt(lines, "2026-10-31")).toBe(B(rs(65_000)));
  });

  it("builds a month-by-month series", () => {
    const series = monthlySeries(lines, ["2026-09", "2026-10"], null);
    expect(series[0]).toMatchObject({ month: "2026-09", income: B(0), netWorth: B(0), kept: null });
    expect(series[1]).toMatchObject({ month: "2026-10", income: B(rs(100_000)), expenses: B(rs(35_000)), netWorth: B(rs(65_000)), kept: 65 });
  });

  it("ranks top expense categories and compares with the previous period", () => {
    const more = [...lines, ...entry("2026-09-05", "EXPENSE", rs(20_000), bank, food)];
    const top = topCategories(more, { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(top.map((t) => t.name)).toEqual(["Food", "Depreciation"]);
    expect(top[0]).toMatchObject({ amount: B(rs(30_000)), prevAmount: B(rs(20_000)), change: 50 });
    expect(top[0].share).toBeCloseTo(85.71, 1);
    expect(top[1].change).toBeNull();
  });
});

describe("with the database", () => {
  let db: UserDb;
  let otherDb: UserDb;
  let acc: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    const me = await prisma.user.create({ data: { name: "Me", email: "me@reports.test", passwordHash: "x" } });
    const other = await prisma.user.create({ data: { name: "Other", email: "other@reports.test", passwordHash: "x" } });
    db = scopedDb(prisma, me.id);
    otherDb = scopedDb(prisma, other.id);
    await ensureDefaultAccounts(db);
    await ensureDefaultAccounts(otherDb);
    acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("net worth from real entries includes assets at book value and subtracts debts", async () => {
    await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(500_000), accountId: acc["Bank account"] });
    await createAsset(db, { name: "Phone", assetClass: "ELECTRONICS", purchaseDate: "2026-01-10", cost: rs(36_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 36, residualValue: 0 }, TODAY);
    await createDebt(db, { name: "Visa", kind: "CREDIT_CARD", startDate: "2026-01-01", rateBasisPoints: 0, ratePeriod: "YEAR", start: { type: "ALREADY_OWE", amount: rs(40_000) } }, TODAY);
    const lines = await getReportLines(db, TODAY);
    // 500,000 bank − 40,000 owed − depreciation Jan–Sep (9 × 1,000)
    expect(netWorthAt(lines, TODAY)).toBe(B(rs(500_000 - 40_000 - 9_000)));
    expect(await getReportLines(otherDb, TODAY)).toHaveLength(0);
  });

  it("lists what's coming up: money due back and payments due, overdue first", async () => {
    await createLoan(db, { counterparty: "Late Ruwan", kind: "CHEQUE_EXCHANGE", startDate: "2026-09-01", dueDate: "2026-10-01", rateBasisPoints: 400, ratePeriod: "MONTH", amount: rs(50_000), upfrontInterest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    await createLoan(db, { counterparty: "Soon Kamal", kind: "CHEQUE_EXCHANGE", startDate: "2026-10-01", dueDate: "2026-11-05", rateBasisPoints: 400, ratePeriod: "MONTH", amount: rs(20_000), upfrontInterest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    await createLoan(db, { counterparty: "Far away", kind: "FIXED_DEPOSIT", startDate: "2026-10-01", dueDate: "2027-10-01", rateBasisPoints: 900, ratePeriod: "YEAR", amount: rs(20_000), upfrontInterest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    await createDebt(db, { name: "Car loan", kind: "BANK_LOAN", startDate: "2026-10-01", rateBasisPoints: 1200, ratePeriod: "YEAR", dueDay: 25, monthlyPayment: rs(25_000), start: { type: "ALREADY_OWE", amount: rs(400_000) } }, TODAY);

    const items = await getUpcoming(db, TODAY);
    expect(items.map((i) => i.name)).toEqual(["Late Ruwan", "Car loan", "Soon Kamal"]);
    expect(items[0].overdue).toBe(true);
    expect(items.find((i) => i.name === "Car loan")).toMatchObject({ date: "2026-10-25", amount: B(rs(25_000)) });
    expect(await getUpcoming(otherDb, TODAY)).toHaveLength(0);
  });
});
