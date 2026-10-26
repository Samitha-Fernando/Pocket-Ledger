import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { exportBackup, exportCsv, exportWorkbook, isEmptyAccount, restoreBackup } from "@/lib/export/personal";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { createAsset } from "@/lib/ledger/assets";
import { accountKey, getBudgets, setBudget } from "@/lib/ledger/budgets";
import { createDebt, makePayment } from "@/lib/ledger/debts";
import { saveEntry, sumLines } from "@/lib/ledger/engine";
import { createLoan } from "@/lib/ledger/loans";
import { resetDb } from "./helpers";

const rs = (rupees: number) => rupees * 100;
const TODAY = "2026-10-26";
let a: UserDb;
let b: UserDb;
let aUser: Awaited<ReturnType<typeof prisma.user.create>>;
let bId: string;

/** Account name → balance, for comparing two users' books. */
async function balances(db: UserDb) {
  return Object.fromEntries((await getAccountsWithBalances(db)).map((x) => [x.name, x.balance.toString()]));
}

beforeAll(async () => {
  await resetDb();
  aUser = await prisma.user.create({ data: { name: "Alice", email: "alice@export.test", passwordHash: "x", lateIncomeDay: 25, currency: "LKR" } });
  const bUser = await prisma.user.create({ data: { name: "Alice (server)", email: "alice2@export.test", passwordHash: "x" } });
  bId = bUser.id;
  a = scopedDb(prisma, aUser.id);
  b = scopedDb(prisma, bUser.id);
  await ensureDefaultAccounts(a);
  await ensureDefaultAccounts(b);
  const acc = Object.fromEntries((await a.account.findMany()).map((x) => [x.name, x.id]));

  // A bit of everything.
  await saveEntry(a, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(800_000), accountId: acc["Bank account"] });
  await saveEntry(a, { kind: "INCOME", date: "2026-09-25", amount: rs(185_000), categoryId: acc["Employment (Net)"], accountId: acc["Bank account"], details: "Salary" });
  const bike = await createAsset(a, { name: "Bike", assetClass: "VEHICLES", purchaseDate: "2026-02-10", cost: rs(480_000), fundingAccountId: acc["Bank account"], usefulLifeMonths: 96, residualValue: rs(96_000) }, TODAY);
  await saveEntry(a, { kind: "EXPENSE", date: "2026-09-02", amount: rs(4_500), categoryId: acc["Assets Repairs & Maintenance"], accountId: acc["Cash in hand"], details: "TW service", assetId: bike });
  const loan = await createLoan(a, { counterparty: "Kamal", kind: "CHEQUE_EXCHANGE", startDate: "2026-09-01", dueDate: "2026-10-01", rateBasisPoints: 400, ratePeriod: "MONTH", interestAccountId: acc["Cheque Exchange Interest"], amount: rs(100_000), upfrontInterest: rs(4_000), fromAccountId: acc["Bank account"] }, TODAY);
  const card = await createDebt(a, { name: "Visa", kind: "CREDIT_CARD", startDate: "2026-01-01", rateBasisPoints: 2800, ratePeriod: "YEAR", creditLimit: rs(300_000), dueDay: 20, start: { type: "ALREADY_OWE", amount: rs(40_000) } }, TODAY);
  await makePayment(a, card, { date: "2026-10-10", principal: rs(15_000), interest: rs(500), fromAccountId: acc["Bank account"], interestAccountId: acc["Interest Paid"] }, TODAY);
  await a.rule.create({ data: { contains: "tw", appliesTo: "EXPENSE", assetId: bike } as never });
  await setBudget(a, "2026-10", accountKey(acc["Groceries"]), rs(40_000));
  await setBudget(a, "2026-10", "DEBTS", rs(15_000));
  void loan;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("exports", () => {
  it("makes an Excel workbook with a sheet per area", async () => {
    const buf = await exportWorkbook(a, aUser, TODAY);
    const book = XLSX.read(buf, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Transactions", "Accounts", "Assets", "Lending", "Cards & loans", "Budgets"]);
    const txns = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Transactions);
    expect(txns.find((t) => t.Details === "Salary")).toMatchObject({ Date: "25/09/2026", Type: "Income", Amount: 185_000 });
    const budgets = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Budgets);
    expect(budgets.map((r) => r.Line).sort()).toEqual(["Debt payments", "Groceries"]);
  });

  it("makes a CSV of transactions", async () => {
    const csv = await exportCsv(a);
    expect(csv.split("\n")[0]).toContain("Date,Type,Category,From,To,Amount,Details");
    expect(csv).toContain("25/09/2026,Income,Employment (Net)");
  });

  it("never includes someone else's data", async () => {
    const csv = await exportCsv(b);
    expect(csv).not.toContain("Salary");
    expect(JSON.parse(await exportBackup(b, await prisma.user.findUniqueOrThrow({ where: { id: bId } }))).tables.entry).toHaveLength(0);
  });
});

describe("personal backup and restore", () => {
  it("restores into an empty account with identical balances and working links", async () => {
    const json = await exportBackup(a, aUser);
    expect(await isEmptyAccount(b)).toBe(true);
    const counts = await restoreBackup(b, bId, json);
    expect(counts.entry).toBe(await a.entry.count());

    // Same books.
    expect(await balances(b)).toEqual(await balances(a));
    for (const e of await b.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(BigInt(0));

    // Links point at the restored records (new ids), never the originals.
    const bBike = await b.fixedAsset.findFirstOrThrow();
    const aBike = await a.fixedAsset.findFirstOrThrow();
    expect(bBike.id).not.toBe(aBike.id);
    expect((await b.entry.findFirstOrThrow({ where: { details: "TW service" } })).assetId).toBe(bBike.id);
    expect((await b.rule.findFirstOrThrow()).assetId).toBe(bBike.id);
    const bLoan = await b.loan.findFirstOrThrow();
    expect(await b.entry.count({ where: { loanId: bLoan.id } })).toBeGreaterThan(0);
    const bCard = await b.debt.findFirstOrThrow();
    expect(await b.entry.count({ where: { debtId: bCard.id } })).toBe(2);
    const bGroceries = (await b.account.findFirstOrThrow({ where: { name: "Groceries" } })).id;
    expect((await getBudgets(b, ["2026-10"])).get(accountKey(bGroceries))?.get("2026-10")).toBe(BigInt(rs(40_000)));

    // Settings come along; the original is untouched.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bId } })).lateIncomeDay).toBe(25);
    expect(await a.entry.count()).toBe(counts.entry);
  });

  it("refuses to restore into an account that already has data, or a file that isn't a backup", async () => {
    const json = await exportBackup(a, aUser);
    await expect(restoreBackup(a, aUser.id, json)).rejects.toThrow(/empty account/);
    await expect(restoreBackup(a, aUser.id, "{not json")).rejects.toThrow(/isn't a Pocket Ledger backup/);
    await expect(restoreBackup(a, aUser.id, JSON.stringify({ app: "other" }))).rejects.toThrow(/isn't a Pocket Ledger backup/);
  });
});
