import * as XLSX from "xlsx";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { applyDraft, loadDraft, monthsAlreadyBudgeted, saveDraft } from "@/lib/import/budget-draft";
import { defaultBudgetTarget, parseBudgetSheet } from "@/lib/import/budget-sheet";
import { ensureDefaultAccounts } from "@/lib/ledger/accounts";
import { createAsset } from "@/lib/ledger/assets";
import {
  ASSETS_KEY,
  DEBTS_KEY,
  accountKey,
  actuals,
  compare,
  copyMonth,
  copyYear,
  fillYear,
  getBudgetLines,
  getBudgets,
  monthsBetween,
  monthsOfYear,
  setBudget,
  totals,
} from "@/lib/ledger/budgets";
import { createDebt, makePayment } from "@/lib/ledger/debts";
import { saveEntry } from "@/lib/ledger/engine";
import { getReportLines } from "@/lib/ledger/reports";
import { resetDb } from "./helpers";

const B = (n: number) => BigInt(n);
const rs = (rupees: number) => rupees * 100;
const TODAY = "2026-10-20";
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;
const k = (name: string) => accountKey(acc[name]);

/** A fake "Budget Planning" sheet laid out like the real one: year above Jan, two year blocks. */
function fakeBudgetSheet() {
  const months = ["Jan ✓", "Feb ✓", "Mar ✓", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Total"];
  const rows: unknown[][] = [];
  rows[1] = [null, null, "Budget Planning"];
  rows[4] = [null, null, "Define starting year", null, 2025, ...Array(13).fill(null), 2026];
  rows[5] = [null, null, null, null, ...months, null, ...months];
  rows[6] = [null, null, "To be allocated"];
  rows[8] = [null, null, "Income"];
  rows[9] = [null, null, "Employment (Net)", null, 185000, 185000, 185000, ...Array(11).fill(null), 190000];
  rows[10] = [null, null, "Enter Income category…"];
  rows[11] = [null, null, "Total"];
  rows[13] = [null, null, "Expenses"];
  rows[14] = [null, null, "Fun & vacation", null, 5000, null, 7500.5];
  rows[15] = [null, null, "Debt", null, 15000];
  rows[16] = [null, null, "Asset Purchases", null, null, 50000];
  rows[17] = [null, null, "Total"];
  rows[19] = [null, null, "Savings"];
  rows[20] = [null, null, "Emergency Fund (AIA Insurance)", null, 5000, 5000];
  rows[21] = [null, null, "Total"];
  const sheet = XLSX.utils.aoa_to_sheet(rows.map((r) => r ?? []));
  sheet["F15"] = { t: "n", v: 2500, f: "1000+1500" }; // a formula cell (Fun, Feb 2025)
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Budget Planning");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@budget.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@budget.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  for (const d of [db, otherDb]) {
    await d.budget.deleteMany();
    await d.budgetDraft.deleteMany();
    await d.entry.deleteMany();
    await d.fixedAsset.deleteMany();
    await d.debt.deleteMany();
    await d.account.deleteMany({ where: { OR: [{ type: "LIABILITY" }, { subtype: "FIXED" }] } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("budget lines and editing", () => {
  it("offers income, expense, savings and the two special lines", async () => {
    const lines = await getBudgetLines(db);
    expect(lines.find((l) => l.label === "Employment (Net)")?.group).toBe("INCOME");
    expect(lines.find((l) => l.label === "Food")?.group).toBe("EXPENSE");
    expect(lines.find((l) => l.label === "AIA Emergency Fund")?.group).toBe("SAVINGS");
    expect(lines.map((l) => l.key)).toEqual(expect.arrayContaining([ASSETS_KEY, DEBTS_KEY]));
    expect(lines.some((l) => l.label === "Depreciation" || l.label === "Opening Balances")).toBe(false);
  });

  it("sets, clears, fills a year, copies a month and a year", async () => {
    await setBudget(db, "2026-01", k("Food"), rs(20_000));
    await setBudget(db, "2026-01", k("Food"), rs(22_000)); // overwrite
    await fillYear(db, 2026, k("Groceries"), rs(40_000));
    let b = await getBudgets(db, monthsOfYear(2026));
    expect(b.get(k("Food"))?.get("2026-01")).toBe(B(rs(22_000)));
    expect(b.get(k("Groceries"))?.size).toBe(12);

    await setBudget(db, "2026-01", k("Food"), 0); // clear
    expect((await getBudgets(db, ["2026-01"])).get(k("Food"))).toBeUndefined();

    await copyMonth(db, "2026-01", "2026-02");
    await copyYear(db, 2026, 2027);
    b = await getBudgets(db, monthsOfYear(2027));
    expect(b.get(k("Groceries"))?.get("2027-06")).toBe(B(rs(40_000)));
    await expect(setBudget(db, "2026-13", k("Food"), 1)).rejects.toThrow(/month/);
    await expect(setBudget(db, "2026-01", k("Food"), -5)).rejects.toThrow(/negative/);
    await expect(setBudget(db, "2026-01", accountKey(acc["Depreciation"]), 1)).rejects.toThrow(/no longer exists/);
  });
});

describe("budget vs actual", () => {
  it("compares every kind of line, with the late income shift", async () => {
    await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(1_000_000), accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "INCOME", date: "2026-09-25", amount: rs(185_000), categoryId: acc["Employment (Net)"], accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "EXPENSE", date: "2026-10-03", amount: rs(46_000), categoryId: acc["Groceries"], accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "TRANSFER", date: "2026-10-05", amount: rs(5_000), fromId: acc["Bank account"], toId: acc["AIA Emergency Fund"] });
    await createAsset(db, { name: "TV", assetClass: "ELECTRONICS", purchaseDate: "2026-10-06", cost: rs(90_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 36, residualValue: 0 }, TODAY);
    const card = await createDebt(db, { name: "Visa", kind: "CREDIT_CARD", startDate: "2026-01-01", rateBasisPoints: 0, ratePeriod: "YEAR", start: { type: "ALREADY_OWE", amount: rs(30_000) } }, TODAY);
    await makePayment(db, card, { date: "2026-10-18", principal: rs(15_000), interest: rs(400), fromAccountId: acc["Bank account"], interestAccountId: acc["Interest Paid"] }, TODAY);

    for (const [line, amount] of [
      [k("Employment (Net)"), 185_000],
      [k("Groceries"), 40_000],
      [k("AIA Emergency Fund"), 5_000],
      [ASSETS_KEY, 100_000],
      [DEBTS_KEY, 15_000],
    ] as const) {
      await setBudget(db, "2026-10", line, rs(amount));
    }

    const lines = await getReportLines(db, TODAY);
    const actual = actuals(lines, "2026-10-01", "2026-10-31", 25);
    const rows = compare(await getBudgetLines(db), await getBudgets(db, ["2026-10"]), ["2026-10"], actual);
    const row = (label: string) => rows.find((r) => r.label === label)!;

    expect(row("Employment (Net)")).toMatchObject({ actual: B(rs(185_000)), status: "under" }); // Sep 25 salary counts in October
    expect(row("Groceries")).toMatchObject({ actual: B(rs(46_000)), remaining: B(rs(-6_000)), percent: 115, status: "over" });
    expect(row("AIA Emergency Fund").actual).toBe(B(rs(5_000)));
    expect(row("Asset purchases")).toMatchObject({ actual: B(rs(90_000)), status: "near" }); // 90%
    expect(row("Debt payments").actual).toBe(B(rs(15_000))); // principal only…
    expect(row("Interest Paid").actual).toBe(B(rs(400))); // …interest shows under its category

    // Without the shift, the salary belongs to September.
    expect(actuals(lines, "2026-10-01", "2026-10-31", null).get(k("Employment (Net)"))).toBeUndefined();

    const t = totals(rows);
    expect(t.toBeAllocated).toBe(B(rs(185_000 - 40_000 - 100_000 - 15_000 - 5_000)));
    expect(t.expense.budget).toBe(B(rs(155_000)));
  });

  it("covers the months of a range", () => {
    expect(monthsBetween("2026-11-10", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("importing the Budget Planning sheet", () => {
  it("reads year blocks, formula values and sections, skipping template rows", () => {
    const lines = parseBudgetSheet(fakeBudgetSheet());
    expect(lines.map((l) => `${l.group}:${l.label}`)).toEqual([
      "INCOME:Employment (Net)",
      "EXPENSE:Fun & vacation",
      "EXPENSE:Debt",
      "EXPENSE:Asset Purchases",
      "SAVINGS:Emergency Fund (AIA Insurance)",
    ]);
    expect(lines[0].values).toEqual({ "2025-01": rs(185_000), "2025-02": rs(185_000), "2025-03": rs(185_000), "2026-01": rs(190_000) });
    expect(lines[1].values).toEqual({ "2025-01": rs(5_000), "2025-02": rs(2_500), "2025-03": 750_050 });
  });

  it("matches lines to the app, including the special Debt and Asset Purchases lines", async () => {
    const accounts = await db.account.findMany();
    const lines = parseBudgetSheet(fakeBudgetSheet());
    expect(lines.map((l) => defaultBudgetTarget(l, accounts))).toEqual([
      k("Employment (Net)"),
      k("Fun & Vacation"),
      DEBTS_KEY,
      ASSETS_KEY,
      k("AIA Emergency Fund"),
    ]);
  });

  it("previews, warns about months already budgeted, and replaces them", async () => {
    await setBudget(db, "2025-01", k("Fun & Vacation"), rs(999));
    await setBudget(db, "2025-01", k("Food"), rs(123)); // not in the sheet's lines: kept
    const lines = parseBudgetSheet(fakeBudgetSheet());
    const draftId = await saveDraft(db, "budget.xlsx", lines);
    expect(await monthsAlreadyBudgeted(db, (await loadDraft(db, draftId)).lines)).toEqual(["2025-01"]);

    const accounts = await db.account.findMany();
    const targets = lines.map((l) => defaultBudgetTarget(l, accounts));
    targets[3] = null; // skip Asset Purchases
    expect(await applyDraft(db, draftId, targets)).toBe(4 + 3 + 1 + 2);

    const b = await getBudgets(db, ["2025-01", "2025-02", "2026-01"]);
    expect(b.get(k("Fun & Vacation"))?.get("2025-01")).toBe(B(rs(5_000))); // replaced
    expect(b.get(k("Food"))?.get("2025-01")).toBe(B(rs(123))); // untouched
    expect(b.get(ASSETS_KEY)).toBeUndefined(); // skipped
    expect(b.get(k("Employment (Net)"))?.get("2026-01")).toBe(B(rs(190_000)));
    await expect(loadDraft(db, draftId)).rejects.toThrow(/expired/); // draft is used up
  });
});

describe("privacy", () => {
  it("another user can't see or use my budgets or drafts", async () => {
    await setBudget(db, "2026-10", k("Food"), rs(10_000));
    const draftId = await saveDraft(db, "x.xlsx", parseBudgetSheet(fakeBudgetSheet()));
    expect((await getBudgets(otherDb, ["2026-10"])).size).toBe(0);
    await expect(loadDraft(otherDb, draftId)).rejects.toThrow(/expired/);
    // My category ids aren't valid budget lines for them.
    await expect(setBudget(otherDb, "2026-10", k("Food"), 1)).rejects.toThrow(/no longer exists/);
  });
});
