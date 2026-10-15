import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { saveEntry, sumLines } from "@/lib/ledger/engine";
import {
  createLoan,
  deleteLoan,
  deleteLoanMovement,
  expectedInterest,
  formatRate,
  getLoanDetails,
  getLoans,
  lendLines,
  lendMore,
  parseRate,
  receiveBack,
  returnLines,
  updateLoanDetails,
  writeOff,
} from "@/lib/ledger/loans";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
const rs = (rupees: number) => rupees * 100;
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;

async function balance(name: string) {
  return (await getAccountsWithBalances(db)).find((a) => a.name === name)!.balance;
}
async function netWorth() {
  const all = await getAccountsWithBalances(db);
  return all.filter((a) => a.type === "ASSET").reduce((s, a) => s + a.balance, ZERO);
}
async function expectAllBalanced() {
  for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
}

/** "Rs 100,000 at 4% a month" cheque exchange, as in the brief. */
const cheque = (over: Partial<Parameters<typeof createLoan>[1]> = {}) => ({
  counterparty: "Kamal",
  kind: "CHEQUE_EXCHANGE",
  startDate: "2026-09-01",
  dueDate: "2026-10-01",
  rateBasisPoints: 400,
  ratePeriod: "MONTH",
  interestAccountId: acc["Cheque Exchange Interest"],
  amount: rs(100_000),
  upfrontInterest: 0,
  fromAccountId: acc["Bank account"],
  ...over,
});

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@loans.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@loans.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  await db.entry.deleteMany();
  await db.loan.deleteMany();
  await db.account.deleteMany({ where: { subtype: "LENT" } });
  await otherDb.entry.deleteMany();
  await otherDb.loan.deleteMany();
  await otherDb.account.deleteMany({ where: { subtype: "LENT" } });
  await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: rs(500_000), accountId: acc["Bank account"] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pure helpers", () => {
  it("reads and shows interest rates without floating point", () => {
    expect(parseRate("4")).toBe(400);
    expect(parseRate("4.5")).toBe(450);
    expect(parseRate("12.25%")).toBe(1225);
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("101")).toBeNull();
    expect(formatRate(450, "MONTH")).toBe("4.5% per month");
    expect(formatRate(900, "YEAR")).toBe("9% per year");
  });

  it("works out expected simple interest", () => {
    expect(expectedInterest(B(rs(100_000)), 400, "MONTH", "2026-09-01", "2026-10-01")).toBe(B(rs(4_000)));
    expect(expectedInterest(B(rs(200_000)), 900, "YEAR", "2026-01-01", "2027-01-01")).toBe(B(rs(18_000)));
    expect(expectedInterest(B(rs(100_000)), 400, "MONTH", "2026-09-01", null)).toBeNull();
  });

  it("lend and money-back lines always balance", () => {
    const ids = { money: "m", loan: "l", interest: "i" };
    expect(sumLines(lendLines(ids, B(100), B(0)))).toBe(ZERO);
    expect(sumLines(lendLines(ids, B(100), B(4)))).toBe(ZERO);
    expect(sumLines(returnLines(ids, B(100), B(4)))).toBe(ZERO);
    expect(sumLines(returnLines(ids, B(0), B(4)))).toBe(ZERO);
    expect(returnLines(ids, B(100), B(0))).toHaveLength(2);
  });
});

describe("lending", () => {
  it("moves money out of the bank into the loan; net worth unchanged", async () => {
    const before = await netWorth();
    const id = await createLoan(db, cheque(), "2026-10-15");
    expect(await balance("Bank account")).toBe(B(rs(400_000)));
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.out).toBe(B(rs(100_000)));
    expect(await netWorth()).toBe(before);
    await expectAllBalanced();
  });

  it("interest kept up front: hand over 96,000, earn 4,000 now, get 100,000 back (option A)", async () => {
    const id = await createLoan(db, cheque({ upfrontInterest: rs(4_000) }), "2026-10-15");
    expect(await balance("Bank account")).toBe(B(rs(404_000)));
    expect(await balance("Cheque Exchange Interest")).toBe(B(rs(4_000)));
    let d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.out).toBe(B(rs(100_000)));
    expect(d.interest).toBe(B(rs(4_000)));

    const status = await receiveBack(db, id, { date: "2026-10-01", principal: rs(100_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15");
    expect(status).toBe("REPAID");
    d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.out).toBe(ZERO);
    expect(d.returnPercent).toBe(4);
    expect(d.loan.closedDate).toBe("2026-10-01");
    expect(await balance("Bank account")).toBe(B(rs(504_000)));
    await expectAllBalanced();
  });

  it("normal cheque exchange: give 100,000, get 104,000 back split into principal + interest", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    await receiveBack(db, id, { date: "2026-10-01", principal: rs(100_000), interest: rs(4_000), intoAccountId: acc["Cash in hand"] }, "2026-10-15");
    expect(await balance("Cash in hand")).toBe(B(rs(104_000)));
    expect(await balance("Cheque Exchange Interest")).toBe(B(rs(4_000)));
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.loan.status).toBe("REPAID");
    expect(d.expected).toBe(B(rs(4_000)));
    await expectAllBalanced();
  });

  it("partial repayments keep it active until everything is back; lending more reopens it", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    expect(await receiveBack(db, id, { date: "2026-09-15", principal: rs(40_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15")).toBe("ACTIVE");
    expect(await receiveBack(db, id, { date: "2026-09-20", principal: rs(60_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15")).toBe("REPAID");
    await lendMore(db, id, { date: "2026-10-02", amount: rs(50_000), upfrontInterest: 0, fromAccountId: acc["Bank account"] }, "2026-10-15");
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.loan.status).toBe("ACTIVE");
    expect(d.out).toBe(B(rs(50_000)));
    expect(d.lent).toBe(B(rs(150_000)));
  });

  it("won't take back more principal than is still out", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    await expect(
      receiveBack(db, id, { date: "2026-10-01", principal: rs(104_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15"),
    ).rejects.toThrow(/more than the amount still out/);
  });

  it("interest received through the normal Income form counts for the loan", async () => {
    const id = await createLoan(db, cheque({ kind: "FIXED_DEPOSIT", counterparty: "Sampath Bank", rateBasisPoints: 900, ratePeriod: "YEAR", dueDate: "2027-09-01" }), "2026-10-15");
    await saveEntry(db, { kind: "INCOME", date: "2026-10-01", amount: rs(1_500), categoryId: acc["Bank Interest"], accountId: acc["Bank account"], loanId: id });
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.interest).toBe(B(rs(1_500)));
    expect(d.out).toBe(B(rs(100_000)));
  });

  it("rejects bad input", async () => {
    await expect(createLoan(db, cheque({ counterparty: " " }), "2026-10-15")).rejects.toThrow(/name/);
    await expect(createLoan(db, cheque({ amount: 0 }), "2026-10-15")).rejects.toThrow(/amount/);
    await expect(createLoan(db, cheque({ upfrontInterest: rs(100_000) }), "2026-10-15")).rejects.toThrow(/less than/);
    await expect(createLoan(db, cheque({ dueDate: "2026-08-01" }), "2026-10-15")).rejects.toThrow(/due date/);
    await expect(createLoan(db, cheque({ startDate: "2026-11-01", dueDate: null }), "2026-10-15")).rejects.toThrow(/future/);
    await expect(createLoan(db, cheque({ fromAccountId: acc["Food"] }), "2026-10-15")).rejects.toThrow(/came from/);
    expect(await db.loan.count()).toBe(0);
  });
});

describe("write-off, undo and delete", () => {
  it("writes off what's still out as Bad debts", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    await receiveBack(db, id, { date: "2026-09-15", principal: rs(30_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15");
    await writeOff(db, id, "2026-10-10", "2026-10-15");
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.loan.status).toBe("WRITTEN_OFF");
    expect(d.out).toBe(ZERO);
    expect(await balance("Bad debts")).toBe(B(rs(70_000)));
    await expectAllBalanced();

    // Undo by deleting the write-off movement.
    const wo = await db.entry.findFirstOrThrow({ where: { kind: "LOAN_WRITE_OFF" } });
    await deleteLoanMovement(db, wo.id);
    expect((await db.loan.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    expect(await balance("Bad debts")).toBe(ZERO);
  });

  it("deleting the whole loan removes its money movements and account", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    const first = await db.entry.findFirstOrThrow({ where: { kind: "LEND" } });
    await expect(deleteLoanMovement(db, first.id)).rejects.toThrow(/whole loan/);
    await deleteLoan(db, id);
    expect(await db.loan.count()).toBe(0);
    expect(await db.account.count({ where: { subtype: "LENT" } })).toBe(0);
    expect(await balance("Bank account")).toBe(B(rs(500_000)));
  });

  it("editing details renames the account but keeps the money", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    await updateLoanDetails(db, id, { counterparty: "Kamal Perera", kind: "PERSONAL_LOAN", dueDate: "2026-12-01", rateBasisPoints: 300, ratePeriod: "MONTH" });
    const d = (await getLoanDetails(db, id, "2026-10-15"))!;
    expect(d.loan.counterparty).toBe("Kamal Perera");
    expect(d.out).toBe(B(rs(100_000)));
    expect((await db.account.findUniqueOrThrow({ where: { id: d.loan.accountId } })).name).toBe("Kamal Perera (personal loan)");
  });
});

describe("register view", () => {
  it("flags overdue and due-soon loans", async () => {
    await createLoan(db, cheque({ counterparty: "Late", dueDate: "2026-10-01" }), "2026-10-15");
    await createLoan(db, cheque({ counterparty: "Soon", dueDate: "2026-11-01" }), "2026-10-15");
    await createLoan(db, cheque({ counterparty: "Later", dueDate: "2027-06-01" }), "2026-10-15");
    const repaid = await createLoan(db, cheque({ counterparty: "Paid", dueDate: "2026-10-01" }), "2026-10-15");
    await receiveBack(db, repaid, { date: "2026-10-01", principal: rs(100_000), interest: 0, intoAccountId: acc["Bank account"] }, "2026-10-15");

    const loans = await getLoans(db, "2026-10-15");
    const by = (name: string) => loans.find((l) => l.loan.counterparty === name)!;
    expect(by("Late").overdue).toBe(true);
    expect(by("Soon").dueSoon).toBe(true);
    expect(by("Later").overdue || by("Later").dueSoon).toBe(false);
    expect(by("Paid").overdue).toBe(false);
  });
});

describe("privacy", () => {
  it("another user can't see, change or link to my loan", async () => {
    const id = await createLoan(db, cheque(), "2026-10-15");
    expect(await getLoanDetails(otherDb, id, "2026-10-15")).toBeNull();
    expect(await getLoans(otherDb, "2026-10-15")).toHaveLength(0);
    const otherBank = (await otherDb.account.findFirstOrThrow({ where: { name: "Bank account" } })).id;
    const otherInterest = (await otherDb.account.findFirstOrThrow({ where: { name: "Bank Interest" } })).id;
    await expect(writeOff(otherDb, id, "2026-10-01", "2026-10-15")).rejects.toThrow(/no longer exists/);
    await expect(
      receiveBack(otherDb, id, { date: "2026-10-01", principal: 1, interest: 0, intoAccountId: otherBank }, "2026-10-15"),
    ).rejects.toThrow(/no longer exists/);
    await expect(deleteLoan(otherDb, id)).rejects.toThrow(/no longer exists/);
    await expect(
      saveEntry(otherDb, { kind: "INCOME", date: "2026-10-01", amount: 100, categoryId: otherInterest, accountId: otherBank, loanId: id }),
    ).rejects.toThrow(/valid loan/);
    // And I can't lend from someone else's bank account.
    await expect(createLoan(db, cheque({ fromAccountId: otherBank }), "2026-10-15")).rejects.toThrow(/came from/);
    expect((await getLoanDetails(db, id, "2026-10-15"))!.out).toBe(B(rs(100_000)));
  });
});
