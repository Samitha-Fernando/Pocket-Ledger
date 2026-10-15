import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { createAsset } from "@/lib/ledger/assets";
import {
  addCharge,
  borrowLines,
  borrowMore,
  createDebt,
  deleteDebt,
  deleteDebtMovement,
  dueDates,
  dueStatus,
  getDebtDetails,
  getDebts,
  makePayment,
  monthlyInterest,
  paymentLines,
  updateDebtDetails,
} from "@/lib/ledger/debts";
import { deleteEntry, saveEntry, sumLines } from "@/lib/ledger/engine";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
const rs = (rupees: number) => rupees * 100;
const TODAY = "2026-10-15";
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;

async function balance(name: string) {
  return (await getAccountsWithBalances(db)).find((a) => a.name === name)!.balance;
}
async function netWorth() {
  const all = await getAccountsWithBalances(db);
  const sum = (t: string) => all.filter((a) => a.type === t).reduce((s, a) => s + a.balance, ZERO);
  return sum("ASSET") - sum("LIABILITY");
}
async function expectAllBalanced() {
  for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
}

const card = (over: Partial<Parameters<typeof createDebt>[1]> = {}) => ({
  name: "Sampath Visa",
  lender: "Sampath Bank",
  kind: "CREDIT_CARD",
  startDate: "2026-01-01",
  rateBasisPoints: 2800,
  ratePeriod: "YEAR",
  creditLimit: rs(300_000),
  dueDay: 25,
  start: { type: "NONE" as const },
  ...over,
});

const loan = (over: Partial<Parameters<typeof createDebt>[1]> = {}) => ({
  name: "Car loan",
  lender: "Commercial Bank",
  kind: "BANK_LOAN",
  startDate: "2026-06-01",
  rateBasisPoints: 1200, // 12% a year = 1% a month
  ratePeriod: "YEAR",
  dueDay: 5,
  monthlyPayment: rs(25_000),
  start: { type: "BORROW" as const, amount: rs(500_000), fees: rs(5_000), intoAccountId: acc["Bank account"], feeAccountId: acc["Interest Paid"] },
  ...over,
});

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@debts.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@debts.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  for (const d of [db, otherDb]) {
    await d.entry.deleteMany();
    await d.fixedAsset.deleteMany();
    await d.debt.deleteMany();
    await d.account.deleteMany({ where: { OR: [{ type: "LIABILITY" }, { subtype: "FIXED" }] } });
  }
  await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(200_000), accountId: acc["Bank account"] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pure helpers", () => {
  it("suggests a month's interest from the rate", () => {
    expect(monthlyInterest(B(rs(500_000)), 1200, "YEAR")).toBe(B(rs(5_000)));
    expect(monthlyInterest(B(rs(100_000)), 200, "MONTH")).toBe(B(rs(2_000)));
    expect(monthlyInterest(ZERO, 1200, "YEAR")).toBe(ZERO);
  });

  it("payment and borrowing lines balance", () => {
    const ids = { money: "m", debt: "d", interest: "i", fee: "f" };
    expect(sumLines(paymentLines(ids, B(100), B(5)))).toBe(ZERO);
    expect(sumLines(paymentLines(ids, B(0), B(5)))).toBe(ZERO);
    expect(sumLines(borrowLines(ids, B(1000), B(0)))).toBe(ZERO);
    expect(sumLines(borrowLines(ids, B(1000), B(10)))).toBe(ZERO);
  });

  it("works out the next and previous due dates (short months included)", () => {
    expect(dueDates(25, "2026-10-15")).toEqual({ upcoming: "2026-10-25", previous: "2026-09-25" });
    expect(dueDates(25, "2026-10-25")).toEqual({ upcoming: "2026-10-25", previous: "2026-09-25" });
    expect(dueDates(25, "2026-10-26")).toEqual({ upcoming: "2026-11-25", previous: "2026-10-25" });
    expect(dueDates(31, "2026-02-10")).toEqual({ upcoming: "2026-02-28", previous: "2026-01-31" });
  });

  it("flags due soon and overdue", () => {
    const base = { dueDay: 20, startDate: "2026-01-01", owed: B(1000) };
    // 5 days before the due date, nothing paid since last due date → due soon.
    expect(dueStatus({ ...base, today: "2026-10-15", paymentDates: ["2026-09-18"] })).toMatchObject({ dueSoon: true, overdue: false });
    // Already paid this cycle → not due soon.
    expect(dueStatus({ ...base, today: "2026-10-15", paymentDates: ["2026-09-25"] }).dueSoon).toBe(false);
    // Due date passed with no payment since the cycle before → overdue.
    expect(dueStatus({ ...base, today: "2026-10-22", paymentDates: ["2026-09-18"] }).overdue).toBe(true);
    // Paid late → no longer overdue.
    expect(dueStatus({ ...base, today: "2026-10-22", paymentDates: ["2026-10-21"] }).overdue).toBe(false);
    // Nothing owed → nothing due.
    expect(dueStatus({ ...base, owed: ZERO, today: "2026-10-15", paymentDates: [] }).dueSoon).toBe(false);
    // Too new to have missed a payment.
    expect(dueStatus({ ...base, startDate: "2026-10-01", today: "2026-10-22", paymentDates: [] }).overdue).toBe(false);
  });
});

describe("credit cards", () => {
  it("buying on the card is an expense and raises what you owe, without touching the bank", async () => {
    const id = await createDebt(db, card(), TODAY);
    const cardAccount = (await db.debt.findUniqueOrThrow({ where: { id } })).accountId;
    const before = await netWorth();
    await saveEntry(db, { kind: "EXPENSE", date: "2026-10-01", amount: rs(12_000), categoryId: acc["Groceries"], accountId: cardAccount });

    expect(await balance("Groceries")).toBe(B(rs(12_000)));
    expect(await balance("Sampath Visa")).toBe(B(rs(12_000)));
    expect(await balance("Bank account")).toBe(B(rs(200_000)));
    expect(await netWorth()).toBe(before - B(rs(12_000)));
    const d = (await getDebtDetails(db, id, TODAY))!;
    expect(d.owed).toBe(B(rs(12_000)));
    expect(d.available).toBe(B(rs(288_000)));
    await expectAllBalanced();
  });

  it("paying the card is NOT an expense: it just moves money and reduces what you owe", async () => {
    const id = await createDebt(db, card({ start: { type: "ALREADY_OWE", amount: rs(40_000) } }), TODAY);
    const expensesBefore = await balance("Interest Paid");
    await makePayment(db, id, { date: "2026-10-10", principal: rs(40_000), interest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    expect(await balance("Sampath Visa")).toBe(ZERO);
    expect(await balance("Bank account")).toBe(B(rs(160_000)));
    expect(await balance("Interest Paid")).toBe(expensesBefore);
    // Cards stay open even at zero.
    expect((await db.debt.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    await expectAllBalanced();
  });

  it("an existing balance owed keeps the books balanced via Opening Balances", async () => {
    const before = await netWorth();
    await createDebt(db, card({ start: { type: "ALREADY_OWE", amount: rs(40_000) } }), TODAY);
    expect(await netWorth()).toBe(before - B(rs(40_000)));
    expect(await balance("Opening Balances")).toBe(B(rs(200_000 - 40_000)));
    await expectAllBalanced();
  });

  it("interest/fees charged are an expense and raise what you owe", async () => {
    const id = await createDebt(db, card(), TODAY);
    await addCharge(db, id, { date: "2026-10-05", amount: rs(1_250), categoryId: acc["Interest Paid"] }, TODAY);
    expect(await balance("Interest Paid")).toBe(B(rs(1_250)));
    const d = (await getDebtDetails(db, id, TODAY))!;
    expect(d.owed).toBe(B(rs(1_250)));
    expect(d.interestAndFees).toBe(B(rs(1_250)));
  });

  it("an asset can be bought on the card", async () => {
    const id = await createDebt(db, card(), TODAY);
    const cardAccount = (await db.debt.findUniqueOrThrow({ where: { id } })).accountId;
    await createAsset(
      db,
      { name: "Laptop", assetClass: "COMPUTERS", purchaseDate: "2026-10-01", cost: rs(240_000), fundingAccountId: cardAccount, usefulLifeMonths: 48, residualValue: 0 },
      TODAY,
    );
    expect((await getDebtDetails(db, id, TODAY))!.owed).toBe(B(rs(240_000)));
    await expectAllBalanced();
  });

  it("a card can't be deleted while purchases use it; its own movements can be removed", async () => {
    const id = await createDebt(db, card({ start: { type: "ALREADY_OWE", amount: rs(1_000) } }), TODAY);
    const cardAccount = (await db.debt.findUniqueOrThrow({ where: { id } })).accountId;
    const purchase = await saveEntry(db, { kind: "EXPENSE", date: "2026-10-01", amount: rs(500), categoryId: acc["Food"], accountId: cardAccount });
    await expect(deleteDebt(db, id)).rejects.toThrow(/purchase/);
    await deleteEntry(db, purchase);
    await deleteDebt(db, id);
    expect(await db.debt.count()).toBe(0);
    expect(await balance("Opening Balances")).toBe(B(rs(200_000)));
  });
});

describe("loans", () => {
  it("borrowing with fees deducted: owe the full amount, receive less, fees are an expense", async () => {
    const id = await createDebt(db, loan(), TODAY);
    expect(await balance("Car loan")).toBe(B(rs(500_000)));
    expect(await balance("Bank account")).toBe(B(rs(695_000)));
    expect(await balance("Interest Paid")).toBe(B(rs(5_000)));
    const d = (await getDebtDetails(db, id, TODAY))!;
    expect(d.suggestedInterest).toBe(B(rs(5_000))); // 1% of 500,000
    await expectAllBalanced();
  });

  it("a payment splits into principal (owed goes down) and interest (expense)", async () => {
    const id = await createDebt(db, loan({ start: { type: "BORROW", amount: rs(500_000), fees: 0, intoAccountId: acc["Bank account"] } }), TODAY);
    await makePayment(db, id, { date: "2026-07-05", principal: rs(20_000), interest: rs(5_000), fromAccountId: acc["Bank account"], interestAccountId: acc["Interest Paid"] }, TODAY);
    const d = (await getDebtDetails(db, id, TODAY))!;
    expect(d.owed).toBe(B(rs(480_000)));
    expect(d.paid).toBe(B(rs(20_000)));
    expect(d.interestAndFees).toBe(B(rs(5_000)));
    expect(await balance("Bank account")).toBe(B(rs(675_000)));
    expect(await balance("Interest Paid")).toBe(B(rs(5_000)));
    await expectAllBalanced();
  });

  it("pawning: one payment of principal + interest pays it off; borrowing again reopens it", async () => {
    const id = await createDebt(
      db,
      loan({ name: "Gold chain pawn", kind: "PAWNING", dueDay: null, monthlyPayment: null, start: { type: "BORROW", amount: rs(80_000), fees: 0, intoAccountId: acc["Cash in hand"] } }),
      TODAY,
    );
    const status = await makePayment(db, id, { date: "2026-09-01", principal: rs(80_000), interest: rs(2_400), fromAccountId: acc["Cash in hand"], interestAccountId: acc["Interest Paid"] }, TODAY);
    expect(status).toBe("PAID_OFF");
    expect((await db.debt.findUniqueOrThrow({ where: { id } })).closedDate).toBe("2026-09-01");
    expect(await borrowMore(db, id, { date: "2026-10-01", amount: rs(30_000), fees: 0, intoAccountId: acc["Cash in hand"] }, TODAY)).toBe("ACTIVE");
  });

  it("won't take more principal than you owe", async () => {
    const id = await createDebt(db, loan(), TODAY);
    await expect(
      makePayment(db, id, { date: "2026-07-05", principal: rs(600_000), interest: 0, fromAccountId: acc["Bank account"] }, TODAY),
    ).rejects.toThrow(/more than you owe/);
  });

  it("deleting a payment restores what you owe", async () => {
    const id = await createDebt(db, loan(), TODAY);
    await makePayment(db, id, { date: "2026-07-05", principal: rs(20_000), interest: 0, fromAccountId: acc["Bank account"] }, TODAY);
    const payment = await db.entry.findFirstOrThrow({ where: { kind: "DEBT_PAYMENT" } });
    await expect(deleteEntry(db, payment.id)).rejects.toThrow(/card or loan's page/);
    await deleteDebtMovement(db, payment.id);
    expect((await getDebtDetails(db, id, TODAY))!.owed).toBe(B(rs(500_000)));
  });

  it("rejects bad input", async () => {
    await expect(createDebt(db, loan({ name: " " }), TODAY)).rejects.toThrow(/name/);
    await expect(createDebt(db, loan({ start: { type: "NONE" } }), TODAY)).rejects.toThrow(/borrowed/);
    await expect(createDebt(db, loan({ dueDay: 40 }), TODAY)).rejects.toThrow(/Due day/);
    await expect(
      createDebt(db, loan({ start: { type: "BORROW", amount: rs(1_000), fees: rs(1_000), intoAccountId: acc["Bank account"] } }), TODAY),
    ).rejects.toThrow(/Fees/);
    await expect(createDebt(db, loan({ startDate: "2026-11-01" }), TODAY)).rejects.toThrow(/future/);
    expect(await db.debt.count()).toBe(0);
  });

  it("a card can't be turned into a loan", async () => {
    const id = await createDebt(db, card(), TODAY);
    await expect(updateDebtDetails(db, id, { ...card(), kind: "BANK_LOAN" })).rejects.toThrow(/can't be changed/);
  });
});

describe("register view", () => {
  it("flags a card payment due soon and lists totals", async () => {
    // Added this month (so it can't have missed a payment yet), due on the 20th.
    await createDebt(db, card({ dueDay: 20, startDate: "2026-10-01", start: { type: "ALREADY_OWE", amount: rs(10_000) } }), TODAY);
    await createDebt(db, loan(), TODAY);
    const list = await getDebts(db, TODAY);
    const visa = list.find((d) => d.debt.name === "Sampath Visa")!;
    expect(visa.dueSoon).toBe(true);
    expect(visa.nextDue).toBe("2026-10-20");
    const total = list.reduce((s, d) => s + d.owed, ZERO);
    expect(total).toBe(B(rs(510_000)));
  });
});

describe("privacy", () => {
  it("another user can't see, pay, charge or spend on my card", async () => {
    const id = await createDebt(db, card({ start: { type: "ALREADY_OWE", amount: rs(5_000) } }), TODAY);
    const cardAccount = (await db.debt.findUniqueOrThrow({ where: { id } })).accountId;
    expect(await getDebtDetails(otherDb, id, TODAY)).toBeNull();
    expect(await getDebts(otherDb, TODAY)).toHaveLength(0);
    const otherBank = (await otherDb.account.findFirstOrThrow({ where: { name: "Bank account" } })).id;
    const otherFood = (await otherDb.account.findFirstOrThrow({ where: { name: "Food" } })).id;
    await expect(makePayment(otherDb, id, { date: "2026-10-01", principal: 100, interest: 0, fromAccountId: otherBank }, TODAY)).rejects.toThrow(/no longer exists/);
    await expect(addCharge(otherDb, id, { date: "2026-10-01", amount: 100, categoryId: otherFood }, TODAY)).rejects.toThrow(/no longer exists/);
    await expect(deleteDebt(otherDb, id)).rejects.toThrow(/no longer exists/);
    await expect(
      saveEntry(otherDb, { kind: "EXPENSE", date: "2026-10-01", amount: 100, categoryId: otherFood, accountId: cardAccount }),
    ).rejects.toThrow(/pay from/);
    expect((await getDebtDetails(db, id, TODAY))!.owed).toBe(B(rs(5_000)));
  });
});
