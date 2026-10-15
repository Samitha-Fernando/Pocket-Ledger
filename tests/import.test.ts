import * as XLSX from "xlsx";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { batchSummary, deleteBatch, postBatch, saveMapping, stageBatch, undoBatch, updateRows } from "@/lib/import/batch";
import { decodeTarget, defaultTarget, encodeTarget, normalise, planRow, type Mapping } from "@/lib/import/mapping";
import { fingerprintAll, parseWorkbook } from "@/lib/import/parse";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { createDebt } from "@/lib/ledger/debts";
import { sumLines } from "@/lib/ledger/engine";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
const TODAY = "2026-10-15";
const THRESHOLD = 5_000_000; // Rs 50,000
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;

/** Excel date serial for a "YYYY-MM-DD". */
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000;

type FakeRow = [string, string, string, number | { f: string; v: number } | null, string];

/** A fake workbook laid out like "Personal Budget Tracker": header on row 11, columns C–I. */
function fakeWorkbook(rows: FakeRow[], lateIncome = true) {
  const book = XLSX.utils.book_new();
  const dash = XLSX.utils.aoa_to_sheet([["Budget Dashboard"]]);
  XLSX.utils.book_append_sheet(book, dash, "Budget Dashboard");

  const sheet = XLSX.utils.aoa_to_sheet([["Budget Tracking"]]);
  XLSX.utils.sheet_add_aoa(sheet, [["Date", "Type", "Category", "Amount", "Details", "Balance", "Effective Date"]], { origin: "C11" });
  rows.forEach(([date, type, category, amount, details], i) => {
    const r = 12 + i;
    sheet[`C${r}`] = { t: "n", v: serial(date), z: "dd/mm/yyyy" };
    sheet[`D${r}`] = { t: "s", v: type };
    sheet[`E${r}`] = { t: "s", v: category };
    if (amount !== null) sheet[`F${r}`] = typeof amount === "number" ? { t: "n", v: amount } : { t: "n", v: amount.v, f: amount.f };
    sheet[`G${r}`] = { t: "s", v: details };
    sheet[`H${r}`] = { t: "n", v: 999, f: "H11+1" }; // running balance: ignored
  });
  sheet["!ref"] = `A1:I${12 + rows.length}`;
  XLSX.utils.book_append_sheet(book, sheet, "Budget Tracking");

  const settings = XLSX.utils.aoa_to_sheet([
    ["Settings"],
    [],
    [null, "Shift late Income:", lateIncome ? "Active" : "Inactive"],
    [null, "Starting on day x in month: ", 25],
  ]);
  XLSX.utils.book_append_sheet(book, settings, "Settings");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const SAMPLE: FakeRow[] = [
  ["2024-12-25", "Income", "Employment (Net)", 75_000, "December salary"],
  ["2025-01-03", "Expenses", "Food", 1_250.5, "Lunch"],
  ["2024-12-28", "Expenses", "Groceries", { f: "12000+2400.25", v: 14_400.25 }, "Weekly shop"], // out of order + formula
  ["2025-01-05", "Savings", "Savings Account", 20_000, "Monthly saving"],
  ["2025-01-06", "Savings", "Emergency Fund (AIA Insurance)", 5_000, "AIA premium"],
  ["2025-01-07", "Expenses", "Fun & vacation", 3_000, "Movie"],
  ["2025-01-08", "Expenses", "Assets Repairs and maintenance", 4_500, "TW service"],
  ["2025-01-10", "Expenses", "Asset Purchases", 185_000, "Laptop"],
  ["2025-01-11", "Expenses", "Asset Purchases", 8_000, "Kettle"],
  ["2025-01-12", "Expenses", "Debt", 15_000, "Card bill"],
  ["2025-01-13", "Income", "Wire nail selling", 2_000, "Sold nails"],
  ["2025-01-14", "Expenses", "Transportation", 200, "Bus"],
  ["2025-01-14", "Expenses", "Transportation", 200, "Bus"], // genuinely repeated row
  ["2025-01-15", "Income", "Bank Interest", null, "Missing amount"],
];

async function balance(name: string) {
  return (await getAccountsWithBalances(db)).find((a) => a.name === name)!.balance;
}

async function stage(rows = SAMPLE) {
  return stageBatch(db, "Personal Budget Tracker.xlsx", parseWorkbook(fakeWorkbook(rows)), THRESHOLD);
}

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@import.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@import.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  for (const d of [db, otherDb]) {
    await d.entry.deleteMany();
    await d.importRow.deleteMany();
    await d.importBatch.deleteMany();
    await d.fixedAsset.deleteMany();
    await d.debt.deleteMany();
    await d.account.deleteMany({ where: { OR: [{ type: "LIABILITY" }, { subtype: "FIXED" }] } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reading the spreadsheet", () => {
  it("finds the table, uses formula results, and reads the late-income setting", () => {
    const parsed = parseWorkbook(fakeWorkbook(SAMPLE));
    expect(parsed.sheetName).toBe("Budget Tracking");
    expect(parsed.rows).toHaveLength(SAMPLE.length);
    expect(parsed.lateIncomeDay).toBe(25);
    const first = parsed.rows[0];
    expect(first).toMatchObject({ rowNumber: 12, date: "2024-12-25", type: "Income", category: "Employment (Net)", amount: 7_500_000, details: "December salary" });
    expect(parsed.rows[2].amount).toBe(1_440_025); // =12000+2400.25
    expect(parsed.rows[1].amount).toBe(125_050);
    expect(parsed.rows.at(-1)!.amount).toBeNull();
  });

  it("is off when the late-income shift isn't Active", () => {
    expect(parseWorkbook(fakeWorkbook(SAMPLE, false)).lateIncomeDay).toBeNull();
  });

  it("rejects files that aren't a budget spreadsheet", () => {
    expect(() => parseWorkbook(Buffer.from("not a spreadsheet at all"))).toThrow();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Hello"]]), "Sheet1");
    expect(() => parseWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer)).toThrow(/Date, Type, Category/);
  });

  it("gives identical rows different fingerprints, stable across uploads", () => {
    const rows = parseWorkbook(fakeWorkbook(SAMPLE)).rows;
    const a = fingerprintAll(rows);
    const b = fingerprintAll(parseWorkbook(fakeWorkbook(SAMPLE)).rows);
    expect(new Set(a).size).toBe(rows.length);
    expect(a).toEqual(b);
  });
});

describe("mapping", () => {
  it("matches categories despite small spelling differences", async () => {
    const accounts = await db.account.findMany();
    expect(normalise("Fun & vacation")).toBe(normalise("Fun & Vacation"));
    expect(defaultTarget("Expenses", "Assets Repairs and maintenance", accounts)).toEqual({ action: "EXPENSE", targetId: acc["Assets Repairs & Maintenance"] });
    expect(defaultTarget("Savings", "Emergency Fund (AIA Insurance)", accounts)).toEqual({ action: "TRANSFER", targetId: acc["AIA Emergency Fund"] });
    expect(defaultTarget("Income", "Wire nail selling", accounts)).toEqual({ action: "INCOME", targetId: acc["Side Sales"] });
    expect(defaultTarget("Expenses", "Debt", accounts)).toEqual({ action: "REVIEW" });
    expect(defaultTarget("Expenses", "Asset Purchases", accounts)).toEqual({ action: "ASSET_RULE", targetId: acc["Other"] });
  });

  it("big asset purchases become assets, small ones expenses", () => {
    const mapping: Mapping = { "Expenses / Asset Purchases": { action: "ASSET_RULE", targetId: "other" } };
    const row = { date: "2025-01-10", type: "Expenses", category: "Asset Purchases", details: "Laptop" };
    expect(planRow({ ...row, amount: B(18_500_000) }, mapping, THRESHOLD)).toMatchObject({ action: "ASSET", assetName: "Laptop" });
    expect(planRow({ ...row, amount: B(800_000) }, mapping, THRESHOLD)).toMatchObject({ action: "EXPENSE", targetId: "other" });
    expect(planRow({ ...row, amount: null }, mapping, THRESHOLD)).toMatchObject({ action: "REVIEW" });
  });

  it("encodes targets for form fields", () => {
    expect(decodeTarget(encodeTarget({ action: "EXPENSE", targetId: "x" }))).toEqual({ action: "EXPENSE", targetId: "x" });
    expect(decodeTarget("SKIP")).toEqual({ action: "SKIP" });
    expect(decodeTarget("HACK:x")).toBeNull();
  });
});

describe("staging, posting and undo", () => {
  it("stages rows with sensible defaults and flags the ones that need you", async () => {
    const id = await stage();
    const rows = await db.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
    const by = (details: string) => rows.find((r) => r.details === details)!;
    expect(by("December salary")).toMatchObject({ action: "INCOME", targetId: acc["Employment (Net)"] });
    expect(by("Monthly saving")).toMatchObject({ action: "TRANSFER", targetId: acc["Savings account"] });
    expect(by("Laptop")).toMatchObject({ action: "ASSET", assetName: "Laptop" });
    expect(by("Kettle")).toMatchObject({ action: "EXPENSE", targetId: acc["Other"] });
    expect(by("Card bill").action).toBe("REVIEW");
    expect(by("Missing amount").action).toBe("REVIEW");
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    expect(batch.accountId).toBe(acc["Bank account"]);
    expect(batch.startingDate).toBe("2024-12-24");
    expect(batch.lateIncomeDay).toBe(25);
    // Nothing posted yet.
    expect(await db.entry.count()).toBe(0);
  });

  it("won't post while rows still need a decision", async () => {
    const id = await stage();
    await expect(postBatch(db, id, TODAY)).rejects.toThrow(/need a decision/);
  });

  it("posts everything, matching the spreadsheet totals, and keeps the original row", async () => {
    const id = await stage();
    const debt = await createDebt(
      db,
      { name: "Visa", kind: "CREDIT_CARD", startDate: "2024-12-01", rateBasisPoints: 0, ratePeriod: "YEAR", start: { type: "ALREADY_OWE", amount: 2_000_000 } },
      TODAY,
    );
    const rows = await db.importRow.findMany({ where: { batchId: id } });
    await updateRows(db, id, [rows.find((r) => r.details === "Card bill")!.id], { action: "DEBT_PAYMENT", targetId: debt });
    await updateRows(db, id, [rows.find((r) => r.details === "Missing amount")!.id], { action: "SKIP" });

    const result = await postBatch(db, id, TODAY);
    expect(result.errors).toEqual([]);
    expect(result.posted).toBe(SAMPLE.length - 1);

    // Money in: 75,000 + 2,000. Out: expenses 1,250.50 + 14,400.25 + 3,000 + 4,500 + 8,000 + 400; laptop 185,000;
    // savings 20,000 + 5,000; card bill 15,000.
    const expected = 75_000 + 2_000 - (1_250.5 + 14_400.25 + 3_000 + 4_500 + 8_000 + 400) - 185_000 - 25_000 - 15_000;
    expect(await balance("Bank account")).toBe(B(Math.round(expected * 100)));
    expect(await balance("Savings account")).toBe(B(2_000_000));
    expect(await balance("AIA Emergency Fund")).toBe(B(500_000));
    expect(await balance("Fun & Vacation")).toBe(B(300_000));
    expect(await balance("Side Sales")).toBe(B(200_000));
    expect(await db.fixedAsset.count()).toBe(1);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id } })).status).toBe("POSTED");

    // Every transaction balances and points back to its spreadsheet row.
    for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
    const salary = await db.entry.findFirstOrThrow({ where: { kind: "INCOME", details: "December salary" }, include: { importRow: true } });
    expect(salary.importRow?.rowNumber).toBe(12);
    expect(JSON.parse(salary.importRow!.raw).category).toBe("Employment (Net)");

    // Spreadsheet vs posted totals agree for every group that was posted.
    for (const g of await batchSummary(db, id)) {
      if (g.skipped === 0 && g.review === 0) expect(g.posted).toBe(g.total);
    }
  });

  it("posts a starting balance when given one", async () => {
    const id = await stage();
    const mapping = JSON.parse((await db.importBatch.findUniqueOrThrow({ where: { id } })).mapping);
    mapping["Expenses / Debt"] = { action: "EXPENSE", targetId: acc["Other"] };
    await saveMapping(db, id, { accountId: acc["Bank account"], startingBalance: 1_000_000, startingDate: "2024-12-24", mapping }, THRESHOLD);
    const missing = (await db.importRow.findMany({ where: { batchId: id, action: "REVIEW" } })).map((r) => r.id);
    await updateRows(db, id, missing, { action: "SKIP" });
    await postBatch(db, id, TODAY);
    expect(await balance("Opening Balances")).toBe(B(1_000_000));
  });

  it("re-uploading the same file (or a longer one) only adds the new rows", async () => {
    const first = await stage();
    const ids = (await db.importRow.findMany({ where: { batchId: first, action: "REVIEW" } })).map((r) => r.id);
    await updateRows(db, first, ids, { action: "SKIP" });
    await postBatch(db, first, TODAY);
    const entriesAfterFirst = await db.entry.count();

    const second = await stage([...SAMPLE, ["2025-02-01", "Expenses", "Food", 900, "New lunch"]]);
    const rows = await db.importRow.findMany({ where: { batchId: second } });
    // The two rows skipped last time weren't posted, so they come back for a decision.
    expect(rows.filter((r) => r.duplicate)).toHaveLength(SAMPLE.length - 2);
    expect(rows.find((r) => r.details === "New lunch")!.action).toBe("EXPENSE");
    const pending = rows.filter((r) => r.action === "REVIEW").map((r) => r.id);
    await updateRows(db, second, pending, { action: "SKIP" });
    await postBatch(db, second, TODAY);
    expect(await db.entry.count()).toBe(entriesAfterFirst + 1);
  });

  it("undoing a batch removes everything it created, including assets", async () => {
    const before = await balance("Bank account");
    const id = await stage();
    const pending = (await db.importRow.findMany({ where: { batchId: id, action: "REVIEW" } })).map((r) => r.id);
    await updateRows(db, id, pending, { action: "SKIP" });
    await postBatch(db, id, TODAY);
    expect(await db.entry.count()).toBeGreaterThan(0);

    await undoBatch(db, id);
    expect(await db.entry.count()).toBe(0);
    expect(await db.fixedAsset.count()).toBe(0);
    expect(await balance("Bank account")).toBe(before);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id } })).status).toBe("UNDONE");

    // After undoing, the same rows can be imported again (they're not duplicates any more).
    const again = await stage();
    expect(await db.importRow.count({ where: { batchId: again, duplicate: true } })).toBe(0);
    await deleteBatch(db, again);
  });

  it("a staged import can be deleted; a posted one must be undone first", async () => {
    const id = await stage();
    const pending = (await db.importRow.findMany({ where: { batchId: id, action: "REVIEW" } })).map((r) => r.id);
    await updateRows(db, id, pending, { action: "SKIP" });
    await postBatch(db, id, TODAY);
    await expect(deleteBatch(db, id)).rejects.toThrow(/Undo/);
    await undoBatch(db, id);
    await deleteBatch(db, id);
    expect(await db.importBatch.count()).toBe(0);
  });
});

describe("privacy", () => {
  it("another user can't see, change or post my import", async () => {
    const id = await stage();
    expect(await otherDb.importBatch.findUnique({ where: { id } })).toBeNull();
    expect(await otherDb.importRow.count({ where: { batchId: id } })).toBe(0);
    await expect(postBatch(otherDb, id, TODAY)).rejects.toThrow(/no longer exists/);
    await expect(updateRows(otherDb, id, [], { action: "SKIP" })).rejects.toThrow(/no longer exists/);
    await expect(undoBatch(otherDb, id)).rejects.toThrow(/no longer exists/);
    // My rows' category ids can't be used by them either: their post would refuse my accounts.
    expect(await db.importRow.count({ where: { batchId: id } })).toBe(SAMPLE.length);
  });
});
