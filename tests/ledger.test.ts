import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import { resetDb } from "./helpers";
import { type EntryInput, assertBalanced, buildLines, deleteEntry, saveEntry, sumLines } from "@/lib/ledger/engine";

const ZERO = BigInt(0);
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>; // account name → id for the main user
let otherCash: string;

async function balanceOf(name: string) {
  const all = await getAccountsWithBalances(db);
  return all.find((a) => a.name === name)!.balance;
}

/** Every line of every entry for this user must sum to zero per entry. */
async function expectAllEntriesBalanced() {
  const entries = await db.entry.findMany({ include: { lines: true } });
  for (const e of entries) expect(sumLines(e.lines)).toBe(ZERO);
}

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@ledger.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@ledger.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
  otherCash = (await otherDb.account.findFirstOrThrow({ where: { name: "Cash in hand" } })).id;
});

beforeEach(async () => {
  await db.entry.deleteMany();
  await otherDb.entry.deleteMany();
  await db.account.updateMany({ data: { archived: false } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("buildLines (pure)", () => {
  const cases: EntryInput[] = [
    { kind: "INCOME", date: "2026-01-25", amount: 18_500_000, categoryId: "inc", accountId: "bank" },
    { kind: "EXPENSE", date: "2026-01-26", amount: 500_000, categoryId: "groc", accountId: "cash" },
    { kind: "TRANSFER", date: "2026-01-27", amount: 2_500_000, fromId: "bank", toId: "sav" },
    { kind: "OPENING_BALANCE", date: "2026-01-01", amount: 1_000_000, accountId: "cash" },
    { kind: "OPENING_BALANCE", date: "2026-01-01", amount: -250_000, accountId: "bank" },
  ];
  it.each(cases)("$kind always balances to zero", (input) => {
    const lines = buildLines(input, "opening");
    expect(sumLines(lines)).toBe(ZERO);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it("an expense takes money out of the paying account and into the category", () => {
    const lines = buildLines({ kind: "EXPENSE", date: "2026-01-26", amount: 500_000, categoryId: "groc", accountId: "cash" });
    expect(lines).toEqual([
      { accountId: "cash", amount: BigInt(-500_000) },
      { accountId: "groc", amount: BigInt(500_000) },
    ]);
  });

  it("refuses unbalanced or one-sided entries", () => {
    expect(() => assertBalanced([{ accountId: "a", amount: BigInt(5) }, { accountId: "b", amount: BigInt(-4) }])).toThrow(/balance/);
    expect(() => assertBalanced([{ accountId: "a", amount: ZERO }])).toThrow();
  });
});

describe("saveEntry (database)", () => {
  it("records income, expense, transfer and opening balances with correct balances", async () => {
    await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: 1_000_000, accountId: acc["Cash in hand"] });
    await saveEntry(db, { kind: "INCOME", date: "2026-01-25", amount: 18_500_000, categoryId: acc["Employment (Net)"], accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "EXPENSE", date: "2026-01-26", amount: 500_000, categoryId: acc["Groceries"], accountId: acc["Cash in hand"] });
    await saveEntry(db, { kind: "TRANSFER", date: "2026-01-27", amount: 2_500_000, fromId: acc["Bank account"], toId: acc["Savings account"] });

    expect(await balanceOf("Cash in hand")).toBe(BigInt(500_000)); // 10,000 − 5,000
    expect(await balanceOf("Bank account")).toBe(BigInt(16_000_000)); // 185,000 − 25,000
    expect(await balanceOf("Savings account")).toBe(BigInt(2_500_000));
    expect(await balanceOf("Employment (Net)")).toBe(BigInt(18_500_000));
    expect(await balanceOf("Groceries")).toBe(BigInt(500_000));
    expect(await balanceOf("Opening Balances")).toBe(BigInt(1_000_000));
    await expectAllEntriesBalanced();

    // The whole ledger nets to zero too.
    const all = await db.entryLine.aggregate({ _sum: { amount: true } });
    expect(all._sum.amount).toBe(ZERO);
  });

  it("stores every line under the signed-in user", async () => {
    const id = await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 100, categoryId: acc["Food"], accountId: acc["Cash in hand"] });
    const lines = await prisma.entryLine.findMany({ where: { entryId: id } });
    const entry = await prisma.entry.findUniqueOrThrow({ where: { id } });
    expect(new Set(lines.map((l) => l.userId))).toEqual(new Set([entry.userId]));
  });

  it("editing replaces the lines and updates balances", async () => {
    const id = await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 300_000, categoryId: acc["Food"], accountId: acc["Cash in hand"] });
    await saveEntry(db, { kind: "EXPENSE", date: "2026-02-02", amount: 120_000, categoryId: acc["Transportation"], accountId: acc["Bank account"] }, id);

    expect(await balanceOf("Food")).toBe(ZERO);
    expect(await balanceOf("Cash in hand")).toBe(ZERO);
    expect(await balanceOf("Transportation")).toBe(BigInt(120_000));
    expect(await balanceOf("Bank account")).toBe(BigInt(-120_000));
    expect(await db.entryLine.count({ where: { entryId: id } })).toBe(2);
    await expectAllEntriesBalanced();
  });

  it("deleting removes the entry and its lines", async () => {
    const id = await saveEntry(db, { kind: "INCOME", date: "2026-02-01", amount: 5000, categoryId: acc["Bank Interest"], accountId: acc["Bank account"] });
    await deleteEntry(db, id);
    expect(await db.entryLine.count()).toBe(0);
    expect(await balanceOf("Bank account")).toBe(ZERO);
  });

  it("rejects zero, negative and invalid amounts and dates", async () => {
    const base = { kind: "EXPENSE" as const, categoryId: acc["Food"], accountId: acc["Cash in hand"] };
    await expect(saveEntry(db, { ...base, date: "2026-02-01", amount: 0 })).rejects.toThrow(/more than zero/);
    await expect(saveEntry(db, { ...base, date: "2026-02-01", amount: -100 })).rejects.toThrow(/more than zero/);
    await expect(saveEntry(db, { ...base, date: "2026-02-01", amount: 1.5 })).rejects.toThrow(/valid amount/);
    await expect(saveEntry(db, { ...base, date: "2026-02-30", amount: 100 })).rejects.toThrow(/date/);
    expect(await db.entry.count()).toBe(0);
  });

  it("rejects accounts of the wrong kind for the form", async () => {
    // Paying "from" an expense category, or income into a category, makes no sense.
    await expect(
      saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 100, categoryId: acc["Food"], accountId: acc["Groceries"] }),
    ).rejects.toThrow(/pay from/);
    await expect(
      saveEntry(db, { kind: "INCOME", date: "2026-02-01", amount: 100, categoryId: acc["Food"], accountId: acc["Bank account"] }),
    ).rejects.toThrow(/income category/);
    await expect(
      saveEntry(db, { kind: "TRANSFER", date: "2026-02-01", amount: 100, fromId: acc["Bank account"], toId: acc["Bank account"] }),
    ).rejects.toThrow(/different/);
    // The system Opening Balances account can't be picked in a form.
    await expect(
      saveEntry(db, { kind: "TRANSFER", date: "2026-02-01", amount: 100, fromId: acc["Opening Balances"], toId: acc["Bank account"] }),
    ).rejects.toThrow();
  });

  it("can't post to another user's account", async () => {
    await expect(
      saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 100, categoryId: acc["Food"], accountId: otherCash }),
    ).rejects.toThrow(/pay from/);
    expect(await prisma.entryLine.count({ where: { accountId: otherCash } })).toBe(0);
  });

  it("can't edit or delete another user's entry", async () => {
    const theirs = await saveEntry(otherDb, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: 999, accountId: otherCash });
    await expect(
      saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: 1, accountId: acc["Cash in hand"] }, theirs),
    ).rejects.toThrow(/no longer exists/);
    await expect(deleteEntry(db, theirs)).rejects.toThrow(/no longer exists/);
    expect(await otherDb.entry.count()).toBe(1);
  });

  it("blocks new entries on archived accounts but lets old entries keep them", async () => {
    const id = await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 100, categoryId: acc["Gym"], accountId: acc["Cash in hand"] });
    await db.account.update({ where: { id: acc["Gym"] }, data: { archived: true } });

    await expect(
      saveEntry(db, { kind: "EXPENSE", date: "2026-02-02", amount: 100, categoryId: acc["Gym"], accountId: acc["Cash in hand"] }),
    ).rejects.toThrow(/archived/);
    // Editing the old entry (e.g. fixing the amount) still works.
    await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: 250, categoryId: acc["Gym"], accountId: acc["Cash in hand"] }, id);
    expect(await balanceOf("Gym")).toBe(BigInt(250));
  });

  it("allows a negative opening balance (e.g. overdraft)", async () => {
    await saveEntry(db, { kind: "OPENING_BALANCE", date: "2026-01-01", amount: -50_000, accountId: acc["Bank account"] });
    expect(await balanceOf("Bank account")).toBe(BigInt(-50_000));
    await expectAllEntriesBalanced();
  });
});
