import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts, getAccountsWithBalances } from "@/lib/ledger/accounts";
import {
  catchUpAllAssets,
  convertAssetToExpense,
  createAsset,
  currentValue,
  deleteRevaluation,
  dueMonths,
  getAssetDetails,
  monthEnd,
  monthlyDepreciation,
  remainingMonths,
  revalueAsset,
  saleLines,
  sellAsset,
  undoSale,
  updateAsset,
} from "@/lib/ledger/assets";
import { deleteEntry, saveEntry, sumLines } from "@/lib/ledger/engine";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
let db: UserDb;
let otherDb: UserDb;
let acc: Record<string, string>;

const rs = (rupees: number) => rupees * 100;

async function balance(name: string) {
  return (await getAccountsWithBalances(db)).find((a) => a.name === name)!.balance;
}
async function netWorth() {
  const all = await getAccountsWithBalances(db);
  return all.filter((a) => a.type === "ASSET").reduce((s, a) => s + a.balance, ZERO) -
    all.filter((a) => a.type === "LIABILITY").reduce((s, a) => s + a.balance, ZERO);
}
async function expectAllBalanced() {
  for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
  expect((await db.entryLine.aggregate({ _sum: { amount: true } }))._sum.amount ?? ZERO).toBe(ZERO);
}
async function valueOf(assetId: string) {
  const a = await db.fixedAsset.findUniqueOrThrow({ where: { id: assetId } });
  return currentValue(db, a.accountId);
}

const phone = (over: Partial<Parameters<typeof createAsset>[1]> = {}) => ({
  name: "Phone",
  assetClass: "ELECTRONICS",
  purchaseDate: "2026-01-10",
  cost: rs(180_000),
  fundingAccountId: acc["Bank account"],
  usefulLifeMonths: 36,
  residualValue: 0,
  ...over,
});

beforeAll(async () => {
  await resetDb();
  const me = await prisma.user.create({ data: { name: "Me", email: "me@assets.test", passwordHash: "x" } });
  const other = await prisma.user.create({ data: { name: "Other", email: "other@assets.test", passwordHash: "x" } });
  db = scopedDb(prisma, me.id);
  otherDb = scopedDb(prisma, other.id);
  await ensureDefaultAccounts(db);
  await ensureDefaultAccounts(otherDb);
  acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
});

beforeEach(async () => {
  await db.entry.deleteMany();
  await db.fixedAsset.deleteMany();
  await db.account.deleteMany({ where: { subtype: "FIXED" } });
  await otherDb.entry.deleteMany();
  await otherDb.fixedAsset.deleteMany();
  await otherDb.account.deleteMany({ where: { subtype: "FIXED" } });
  await saveEntry(db, { kind: "OPENING_BALANCE", date: "2025-01-01", amount: rs(1_000_000), accountId: acc["Bank account"] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("depreciation maths (pure)", () => {
  it("knows month ends, including leap years", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });

  it("counts the purchase month as month 1", () => {
    expect(remainingMonths("2026-01-10", 36, "2026-01")).toBe(36);
    expect(remainingMonths("2026-01-10", 36, "2028-12")).toBe(1);
    expect(remainingMonths("2026-01-10", 36, "2029-01")).toBe(0);
  });

  it("spreads cost evenly and lands exactly on the leftover value", () => {
    // Awkward numbers: Rs 1,000.00 over 3 months with Rs 0.01 leftover.
    let book = B(100_000);
    const residual = B(1);
    const amounts: bigint[] = [];
    for (let left = 3; left >= 1; left--) {
      const d = monthlyDepreciation(book, residual, left);
      amounts.push(d);
      book -= d;
    }
    expect(book).toBe(residual);
    expect(amounts.reduce((a, b) => a + b)).toBe(B(99_999));
    expect(amounts).toEqual([B(33_333), B(33_333), B(33_333)]);
  });

  it("never goes below the leftover value or past the end of life", () => {
    expect(monthlyDepreciation(B(500), B(500), 10)).toBe(ZERO);
    expect(monthlyDepreciation(B(500), B(0), 0)).toBe(ZERO);
  });

  it("only months that have ended are due", () => {
    const a = { purchaseDate: "2026-01-31", usefulLifeMonths: 36 };
    expect(dueMonths(a, "2026-01-30")).toEqual([]);
    expect(dueMonths(a, "2026-01-31")).toEqual(["2026-01"]);
    expect(dueMonths(a, "2026-04-15")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(dueMonths({ purchaseDate: "2020-01-01", usefulLifeMonths: 12 }, "2026-01-01")).toHaveLength(12);
  });

  it("sale lines balance for gains, losses and scrapping", () => {
    const ids = { asset: "a", money: "m", gain: "g", loss: "l" };
    for (const [book, price] of [[100, 150], [100, 40], [100, 0], [100, 100], [0, 50]]) {
      const lines = saleLines(ids, B(book), B(price));
      expect(sumLines(lines)).toBe(ZERO);
    }
    expect(saleLines(ids, B(100), B(150)).find((l) => l.accountId === "g")?.amount).toBe(B(-50));
    expect(saleLines(ids, B(100), B(40)).find((l) => l.accountId === "l")?.amount).toBe(B(60));
  });
});

describe("buying an asset", () => {
  it("moves money from the bank into the asset, not into expenses; net worth unchanged", async () => {
    const before = await netWorth();
    const id = await createAsset(db, phone(), "2026-01-15");
    expect(await balance("Bank account")).toBe(B(rs(820_000)));
    expect(await valueOf(id)).toBe(B(rs(180_000)));
    expect(await netWorth()).toBe(before);
    expect(await db.entry.count({ where: { kind: "EXPENSE" } })).toBe(0);
    await expectAllBalanced();
  });

  it("posts monthly depreciation for months that have ended, from the purchase month", async () => {
    const id = await createAsset(db, phone(), "2026-04-10"); // Jan, Feb, Mar have ended
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(3);
    expect(await valueOf(id)).toBe(B(rs(180_000 - 3 * 5_000)));
    expect(await balance("Depreciation")).toBe(B(rs(15_000)));
    const dep = await db.entry.findFirstOrThrow({ where: { kind: "DEPRECIATION" }, orderBy: { date: "asc" } });
    expect(dep.date).toBe("2026-01-31");
    await expectAllBalanced();
  });

  it("catching up twice never posts twice", async () => {
    await createAsset(db, phone(), "2026-01-15");
    await catchUpAllAssets(db, "2026-06-30");
    await catchUpAllAssets(db, "2026-06-30");
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(6);
  });

  it("stops at the leftover value at the end of its life", async () => {
    const id = await createAsset(db, phone({ purchaseDate: "2020-03-05", residualValue: rs(10_000) }), "2026-01-01");
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(36);
    expect(await valueOf(id)).toBe(B(rs(10_000)));
    await catchUpAllAssets(db, "2027-01-01");
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(36);
  });

  it("a life of 0 means it doesn't lose value", async () => {
    const id = await createAsset(db, phone({ name: "Gold chain", assetClass: "OTHER", usefulLifeMonths: 0 }), "2026-09-01");
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(0);
    expect(await valueOf(id)).toBe(B(rs(180_000)));
  });

  it("rejects bad input", async () => {
    await expect(createAsset(db, phone({ cost: 0 }), "2026-02-01")).rejects.toThrow(/more than zero/);
    await expect(createAsset(db, phone({ residualValue: rs(200_000) }), "2026-02-01")).rejects.toThrow(/Leftover/);
    await expect(createAsset(db, phone({ purchaseDate: "2026-03-01" }), "2026-02-01")).rejects.toThrow(/future/);
    await expect(createAsset(db, phone({ fundingAccountId: acc["Groceries"] }), "2026-02-01")).rejects.toThrow(/pay from/);
    expect(await db.fixedAsset.count()).toBe(0);
  });

  it("editing the cost re-calculates all depreciation", async () => {
    const id = await createAsset(db, phone(), "2026-04-10");
    await updateAsset(db, id, phone({ cost: rs(360_000) }), "2026-04-10");
    expect(await valueOf(id)).toBe(B(rs(360_000 - 3 * 10_000)));
    expect(await balance("Bank account")).toBe(B(rs(640_000)));
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(3);
    await expectAllBalanced();
  });
});

describe("value changes", () => {
  it("posts a loss and spreads the new value over the remaining life", async () => {
    const id = await createAsset(db, phone(), "2026-04-10");
    // After Jan–Mar: 165,000. Cracked screen: now worth 100,000.
    await revalueAsset(db, id, "2026-03-31", rs(100_000), "2026-04-10");
    expect(await valueOf(id)).toBe(B(rs(100_000)));
    expect(await balance("Loss on assets")).toBe(B(rs(65_000)));
    // March depreciation is unchanged (value change applies after it).
    expect(await balance("Depreciation")).toBe(B(rs(15_000)));

    await catchUpAllAssets(db, "2028-12-31");
    expect(await valueOf(id)).toBe(ZERO);
    await expectAllBalanced();
  });

  it("posts a gain when the value goes up, and removing it restores the schedule", async () => {
    const id = await createAsset(db, phone(), "2026-04-10");
    await revalueAsset(db, id, "2026-02-15", rs(200_000), "2026-04-10");
    expect(await balance("Gain on assets")).toBe(B(rs(25_000))); // 175,000 → 200,000

    const reval = await db.entry.findFirstOrThrow({ where: { kind: "ASSET_REVALUATION" } });
    await deleteRevaluation(db, reval.id, "2026-04-10");
    expect(await valueOf(id)).toBe(B(rs(165_000)));
    expect(await balance("Gain on assets")).toBe(ZERO);
    await expectAllBalanced();
  });
});

describe("selling and scrapping", () => {
  it("sells for more than its value: gain posted, depreciation stops", async () => {
    const id = await createAsset(db, phone(), "2026-06-05"); // Jan–May posted: 155,000
    await sellAsset(db, id, { date: "2026-03-20", price: rs(170_000), accountId: acc["Cash in hand"], status: "SOLD" }, "2026-06-05");
    // Only Jan + Feb before the sale: value 170,000 → sold for 170,000, no gain/loss.
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(2);
    expect(await valueOf(id)).toBe(ZERO);
    expect(await balance("Cash in hand")).toBe(B(rs(170_000)));
    expect(await balance("Gain on assets")).toBe(ZERO);
    expect(await balance("Loss on assets")).toBe(ZERO);

    await catchUpAllAssets(db, "2027-01-01");
    expect(await db.entry.count({ where: { kind: "DEPRECIATION" } })).toBe(2);
    await expectAllBalanced();
  });

  it("books a gain or loss for the difference", async () => {
    const a = await createAsset(db, phone(), "2026-03-01"); // Jan, Feb → 170,000
    await sellAsset(db, a, { date: "2026-03-01", price: rs(180_000), accountId: acc["Bank account"], status: "SOLD" }, "2026-03-01");
    expect(await balance("Gain on assets")).toBe(B(rs(10_000)));

    const b = await createAsset(db, phone({ name: "Laptop" }), "2026-03-01");
    await sellAsset(db, b, { date: "2026-03-01", price: 0, status: "DISPOSED" }, "2026-03-01");
    expect(await balance("Loss on assets")).toBe(B(rs(170_000)));
    expect((await db.fixedAsset.findUniqueOrThrow({ where: { id: b } })).status).toBe("DISPOSED");
    await expectAllBalanced();
  });

  it("undoing a sale brings the asset back and resumes depreciation", async () => {
    const id = await createAsset(db, phone(), "2026-03-01");
    await sellAsset(db, id, { date: "2026-03-01", price: rs(150_000), accountId: acc["Bank account"], status: "SOLD" }, "2026-03-01");
    await undoSale(db, id, "2026-05-01");
    expect(await db.entry.count({ where: { kind: "ASSET_SALE" } })).toBe(0);
    expect(await valueOf(id)).toBe(B(rs(180_000 - 4 * 5_000)));
    await expectAllBalanced();
  });
});

describe("expense ↔ asset and repairs", () => {
  it("converts an expense into an asset", async () => {
    const expenseId = await saveEntry(db, { kind: "EXPENSE", date: "2026-01-10", amount: rs(180_000), categoryId: acc["Other"], accountId: acc["Bank account"] });
    const id = await createAsset(db, phone(), "2026-02-01", expenseId);
    expect(await db.entry.findUnique({ where: { id: expenseId } })).toBeNull();
    expect(await balance("Other")).toBe(ZERO);
    expect(await balance("Bank account")).toBe(B(rs(820_000)));
    expect(await valueOf(id)).toBe(B(rs(175_000)));
    await expectAllBalanced();
  });

  it("converts an asset back into an expense, keeping linked repairs", async () => {
    const id = await createAsset(db, phone(), "2026-04-10");
    await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: rs(4_000), categoryId: acc["Assets Repairs & Maintenance"], accountId: acc["Cash in hand"], assetId: id });
    await revalueAsset(db, id, "2026-03-31", rs(100_000), "2026-04-10");

    await convertAssetToExpense(db, id, acc["Other"]);
    expect(await db.fixedAsset.count()).toBe(0);
    expect(await balance("Other")).toBe(B(rs(180_000)));
    expect(await balance("Depreciation")).toBe(ZERO);
    expect(await balance("Loss on assets")).toBe(ZERO);
    expect(await balance("Assets Repairs & Maintenance")).toBe(B(rs(4_000)));
    expect(await balance("Bank account")).toBe(B(rs(820_000)));
    await expectAllBalanced();
  });

  it("shows the true cost of owning it: price + repairs − value now", async () => {
    const id = await createAsset(db, phone(), "2026-04-10");
    await saveEntry(db, { kind: "EXPENSE", date: "2026-02-01", amount: rs(4_000), categoryId: acc["Assets Repairs & Maintenance"], accountId: acc["Cash in hand"], assetId: id });
    const d = (await getAssetDetails(db, id))!;
    expect(d.repairsTotal).toBe(B(rs(4_000)));
    expect(d.value).toBe(B(rs(165_000)));
    expect(d.trueCost).toBe(B(rs(180_000 + 4_000 - 165_000)));
    expect(d.schedule.filter((s) => !s.projected)).toHaveLength(3);
    expect(d.schedule.at(-1)?.valueAfter).toBe(ZERO);
    expect(d.schedule).toHaveLength(36);
  });

  it("asset entries can't be edited or deleted like normal transactions", async () => {
    await createAsset(db, phone(), "2026-02-01");
    const purchase = await db.entry.findFirstOrThrow({ where: { kind: "ASSET_PURCHASE" } });
    await expect(deleteEntry(db, purchase.id)).rejects.toThrow(/asset's page/);
    await expect(
      saveEntry(db, { kind: "EXPENSE", date: "2026-01-10", amount: 1, categoryId: acc["Food"], accountId: acc["Bank account"] }, purchase.id),
    ).rejects.toThrow(/asset's page/);
  });
});

describe("privacy", () => {
  it("another user can't see, sell, value or link to my asset", async () => {
    const id = await createAsset(db, phone(), "2026-02-01");
    expect(await otherDb.fixedAsset.findUnique({ where: { id } })).toBeNull();
    expect(await getAssetDetails(otherDb, id)).toBeNull();
    await expect(sellAsset(otherDb, id, { date: "2026-02-01", price: 0, status: "DISPOSED" }, "2026-02-01")).rejects.toThrow(/no longer exists/);
    await expect(revalueAsset(otherDb, id, "2026-02-01", 1, "2026-02-01")).rejects.toThrow(/no longer exists/);
    const otherCash = (await otherDb.account.findFirstOrThrow({ where: { name: "Cash in hand" } })).id;
    const otherFood = (await otherDb.account.findFirstOrThrow({ where: { name: "Food" } })).id;
    await expect(
      saveEntry(otherDb, { kind: "EXPENSE", date: "2026-02-01", amount: 100, categoryId: otherFood, accountId: otherCash, assetId: id }),
    ).rejects.toThrow(/valid asset/);
    expect((await db.fixedAsset.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
  });
});
