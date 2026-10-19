import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { createAsset } from "@/lib/ledger/assets";
import { applyBulk } from "@/lib/ledger/bulk";
import { createDebt } from "@/lib/ledger/debts";
import { deleteEntry, saveEntry, sumLines } from "@/lib/ledger/engine";
import { describeDiff } from "@/lib/ledger/history";
import { createLoan } from "@/lib/ledger/loans";
import { applyRule, previewRule, ruleChanges, ruleMatches, validateRule } from "@/lib/ledger/rules";
import { parseFilters, searchEntries } from "@/lib/ledger/search";
import { formatMoney } from "@/lib/format";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
const rs = (rupees: number) => rupees * 100;
const TODAY = "2026-10-19";
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;

async function balance(name: string) {
  return (await getAccountsWithBalances(db)).find((a) => a.name === name)!.balance;
}
async function expectAllBalanced() {
  for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
}
const expense = (date: string, amount: number, category: string, details: string, account = "Bank account") =>
  saveEntry(db, { kind: "EXPENSE", date, amount: rs(amount), categoryId: acc[category], accountId: acc[account], details });
const filters = (params: Record<string, string | string[]> = {}) => parseFilters({ range: "all", ...params }, TODAY);

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@wb.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@wb.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  for (const d of [db, otherDb]) {
    await d.entryChange.deleteMany();
    await d.rule.deleteMany();
    await d.entry.deleteMany();
    await d.fixedAsset.deleteMany();
    await d.loan.deleteMany();
    await d.debt.deleteMany();
    await d.account.deleteMany({ where: { OR: [{ type: "LIABILITY" }, { subtype: { in: ["FIXED", "LENT"] } }] } });
  }
  await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(500_000), accountId: acc["Bank account"] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("filters", () => {
  it("defaults to this month and reads old ?month= links", () => {
    expect(parseFilters({}, TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", sort: "date-desc", group: "day" });
    expect(parseFilters({ month: "2026-09" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(parseFilters({ month: "2026-02" }, TODAY)).toMatchObject({ to: "2026-02-28" });
    expect(parseFilters({ range: "all" }, TODAY)).toMatchObject({ from: "", to: "" });
  });

  it("finds by text, type, category, account, amount and date, with totals", async () => {
    await expense("2026-09-02", 1_200, "Food", "TW lunch");
    await expense("2026-09-03", 4_500, "Transportation", "TW service", "Cash in hand");
    await expense("2026-10-01", 900, "Food", "Bakery");
    await saveEntry(db, { kind: "INCOME", date: "2026-09-25", amount: rs(185_000), categoryId: acc["Employment (Net)"], accountId: acc["Bank account"], details: "Salary" });

    expect((await searchEntries(db, filters({ q: "tw" }))).rows).toHaveLength(2); // case doesn't matter
    expect((await searchEntries(db, filters({ type: "expense" }))).rows).toHaveLength(3);
    expect((await searchEntries(db, filters({ category: acc["Food"] }))).rows).toHaveLength(2);
    expect((await searchEntries(db, filters({ account: acc["Cash in hand"] }))).rows).toHaveLength(1);
    expect((await searchEntries(db, filters({ min: "1000", max: "5000" }))).rows.map((r) => r.details).sort()).toEqual(["TW lunch", "TW service"]);
    expect((await searchEntries(db, filters({ from: "2026-10-01", to: "2026-10-31" }))).rows).toHaveLength(1);

    const sorted = await searchEntries(db, filters({ type: ["expense", "income"], sort: "amount-desc" }));
    expect(sorted.rows[0].details).toBe("Salary");
    expect(sorted.totals).toMatchObject({ count: 4, income: rs(185_000), expenses: rs(1_200 + 4_500 + 900) });
  });

  it("marks register movements as not bulk-editable", async () => {
    await createAsset(db, { name: "Phone", assetClass: "ELECTRONICS", purchaseDate: "2026-09-01", cost: rs(100_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 36, residualValue: 0 }, TODAY);
    await expense("2026-09-02", 100, "Food", "Tea");
    const { rows } = await searchEntries(db, filters());
    expect(rows.find((r) => r.kind === "ASSET_PURCHASE")!.editable).toBe(false);
    expect(rows.find((r) => r.kind === "DEPRECIATION")!.editable).toBe(false);
    expect(rows.find((r) => r.kind === "OPENING_BALANCE")!.editable).toBe(false);
    expect(rows.find((r) => r.details === "Tea")!.editable).toBe(true);
  });
});

describe("bulk changes", () => {
  it("changes category and account for many at once, skipping ones it doesn't fit", async () => {
    const a = await expense("2026-09-02", 1_000, "Other", "Fuel 1");
    const b = await expense("2026-09-03", 2_000, "Other", "Fuel 2");
    const t = await saveEntry(db, { kind: "TRANSFER", date: "2026-09-04", amount: rs(10_000), fromId: acc["Bank account"], toId: acc["Savings account"] });

    const r1 = await applyBulk(db, [a, b, t], { op: "category", categoryId: acc["Transportation"] }, TODAY);
    expect(r1).toEqual({ changed: 2, skipped: 1, errors: [] });
    expect(await balance("Transportation")).toBe(B(rs(3_000)));
    expect(await balance("Other")).toBe(ZERO);

    await applyBulk(db, [a, b], { op: "account", accountId: acc["Cash in hand"] }, TODAY);
    expect(await balance("Cash in hand")).toBe(B(rs(-3_000)));
    await expectAllBalanced();
  });

  it("an expense category can't be put on income (that row errors, others carry on)", async () => {
    const inc = await saveEntry(db, { kind: "INCOME", date: "2026-09-25", amount: rs(100), categoryId: acc["Bank Interest"], accountId: acc["Bank account"] });
    const exp = await expense("2026-09-02", 100, "Other", "x");
    const r = await applyBulk(db, [inc, exp], { op: "category", categoryId: acc["Food"] }, TODAY);
    expect(r.changed).toBe(1);
    expect(r.errors).toHaveLength(1);
  });

  it("links repairs to an asset and interest to a loan", async () => {
    const asset = await createAsset(db, { name: "Bike", assetClass: "VEHICLES", purchaseDate: "2026-01-10", cost: rs(400_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 96, residualValue: 0 }, TODAY);
    const loan = await createLoan(db, { counterparty: "Kamal", kind: "CHEQUE_EXCHANGE", startDate: "2026-09-01", rateBasisPoints: 400, ratePeriod: "MONTH", amount: rs(50_000), upfrontInterest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    const repair = await expense("2026-09-02", 4_500, "Assets Repairs & Maintenance", "TW service");
    const interest = await saveEntry(db, { kind: "INCOME", date: "2026-10-01", amount: rs(2_000), categoryId: acc["Cheque Exchange Interest"], accountId: acc["Bank account"] });
    await applyBulk(db, [repair], { op: "linkAsset", assetId: asset }, TODAY);
    await applyBulk(db, [interest], { op: "linkLoan", loanId: loan }, TODAY);
    expect((await db.entry.findUniqueOrThrow({ where: { id: repair } })).assetId).toBe(asset);
    expect((await db.entry.findUniqueOrThrow({ where: { id: interest } })).loanId).toBe(loan);
  });

  it("converts expenses into assets, transfers and card payments", async () => {
    const tv = await expense("2026-09-02", 90_000, "Other", "Samsung TV");
    const saving = await expense("2026-09-03", 20_000, "Other", "Moved to savings");
    const cardBill = await expense("2026-09-04", 15_000, "Other", "Card bill");
    const card = await createDebt(db, { name: "Visa", kind: "CREDIT_CARD", startDate: "2026-01-01", rateBasisPoints: 0, ratePeriod: "YEAR", start: { type: "ALREADY_OWE", amount: rs(40_000) } }, TODAY);

    expect((await applyBulk(db, [tv], { op: "toAsset", assetClass: "ELECTRONICS", lifeMonths: 36 }, TODAY)).changed).toBe(1);
    expect((await db.fixedAsset.findFirstOrThrow()).name).toBe("Samsung TV");
    expect((await applyBulk(db, [saving], { op: "toTransfer", toAccountId: acc["Savings account"] }, TODAY)).changed).toBe(1);
    expect(await balance("Savings account")).toBe(B(rs(20_000)));
    expect((await applyBulk(db, [cardBill], { op: "toDebtPayment", debtId: card }, TODAY)).changed).toBe(1);
    expect(await balance("Visa")).toBe(B(rs(25_000)));
    expect(await balance("Other")).toBe(ZERO);
    // Money left the bank exactly once for each.
    expect(await balance("Bank account")).toBe(B(rs(500_000 - 90_000 - 20_000 - 15_000)));
    await expectAllBalanced();
  });

  it("deletes many, and register movements are never touched", async () => {
    const a = await expense("2026-09-02", 100, "Food", "a");
    const b = await expense("2026-09-03", 100, "Food", "b");
    const opening = (await db.entry.findFirstOrThrow({ where: { kind: "OPENING_BALANCE" } })).id;
    const r = await applyBulk(db, [a, b, opening], { op: "delete" }, TODAY);
    expect(r).toEqual({ changed: 2, skipped: 1, errors: [] });
    expect(await db.entry.count({ where: { kind: "OPENING_BALANCE" } })).toBe(1);
  });

  it("can't touch another user's transactions", async () => {
    const mine = await expense("2026-09-02", 100, "Food", "mine");
    const r = await applyBulk(otherDb, [mine], { op: "delete" }, TODAY);
    expect(r).toEqual({ changed: 0, skipped: 1, errors: [] });
    expect(await db.entry.findUnique({ where: { id: mine } })).not.toBeNull();
    expect((await searchEntries(otherDb, filters())).rows).toHaveLength(0);
  });
});

describe("rules", () => {
  it("matches details case-insensitively and only on the right kind", () => {
    const rule = { contains: "TW", appliesTo: "EXPENSE", categoryId: null, assetId: "bike", loanId: null, accountId: null };
    expect(ruleMatches(rule, "tw service", "EXPENSE")).toBe(true);
    expect(ruleMatches(rule, "tw service", "INCOME")).toBe(false);
    expect(ruleMatches(rule, "bus", "EXPENSE")).toBe(false);
    expect(ruleChanges(rule, { kind: "EXPENSE", assetId: null })).toEqual({ assetId: "bike" });
    expect(ruleChanges(rule, { kind: "EXPENSE", assetId: "bike" })).toEqual({});
  });

  it("previews then applies to past transactions, recording it in the history", async () => {
    const bike = await createAsset(db, { name: "Bike", assetClass: "VEHICLES", purchaseDate: "2026-01-10", cost: rs(400_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 96, residualValue: 0 }, TODAY);
    const s1 = await expense("2026-09-02", 4_500, "Other", "TW service");
    await expense("2026-09-03", 3_000, "Other", "New tyre for tw");
    await expense("2026-09-04", 500, "Food", "Lunch");

    const input = await validateRule(db, { contains: "TW", appliesTo: "ANY", assetId: bike, categoryId: acc["Assets Repairs & Maintenance"] });
    expect(input.appliesTo).toBe("EXPENSE");
    const rule = await db.rule.create({ data: input as never });
    expect(await previewRule(db, rule)).toHaveLength(2);

    expect((await applyRule(db, rule.id)).changed).toBe(2);
    expect(await balance("Assets Repairs & Maintenance")).toBe(B(rs(7_500)));
    expect((await db.entry.findUniqueOrThrow({ where: { id: s1 } })).assetId).toBe(bike);
    expect(await previewRule(db, rule)).toHaveLength(0); // nothing left to change
    const changes = await db.entryChange.findMany({ where: { entryId: s1 }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => c.action)).toEqual(["CREATE", "RULE"]);
  });

  it("rejects rules that don't make sense", async () => {
    await expect(validateRule(db, { contains: " ", appliesTo: "ANY", categoryId: acc["Food"] })).rejects.toThrow(/text/);
    await expect(validateRule(db, { contains: "x", appliesTo: "ANY" })).rejects.toThrow(/at least one/);
    await expect(validateRule(db, { contains: "x", appliesTo: "INCOME", categoryId: acc["Food"], loanId: "nope" })).rejects.toThrow();
    const otherFood = (await otherDb.account.findFirstOrThrow({ where: { name: "Food" } })).id;
    await expect(validateRule(db, { contains: "x", appliesTo: "ANY", categoryId: otherFood })).rejects.toThrow(/valid category/);
  });
});

describe("edit history", () => {
  it("keeps created, edited and deleted (with before → after)", async () => {
    const id = await expense("2026-09-02", 1_000, "Food", "Lunch");
    await saveEntry(db, { kind: "EXPENSE", date: "2026-09-02", amount: rs(1_250), categoryId: acc["Groceries"], accountId: acc["Bank account"], details: "Lunch" }, id);
    await deleteEntry(db, id);
    const changes = await db.entryChange.findMany({ where: { entryId: id }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => c.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    const update = changes[1];
    const diff = describeDiff(JSON.parse(update.before!), JSON.parse(update.after!), (c) => formatMoney(c));
    expect(diff).toContain("amount Rs 1,000.00 → Rs 1,250.00");
    expect(diff.some((d) => d.includes("Food") && d.includes("Groceries"))).toBe(true);
    expect(changes[2].after).toBeNull();
    // History survives the deletion and is private.
    expect(await otherDb.entryChange.count({ where: { entryId: id } })).toBe(0);
  });
});
