import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb, type UserDb } from "@/lib/db/scoped";
import { ensureDefaultAccounts } from "@/lib/ledger/accounts";
import { type FxContext, LedgerError, buildLines, saveEntry, sumLines } from "@/lib/ledger/engine";
import { bookValueOut, formatRate, impliedRate, parseRate, rateOn, toBase } from "@/lib/ledger/fx";
import { type ReportLine, flows, netWorthAt } from "@/lib/ledger/reports";
import { exportBackup, restoreBackup } from "@/lib/export/personal";
import { resetDb } from "./helpers";

const ZERO = BigInt(0);
const B = (n: number) => BigInt(n);
const usd = (dollars: number) => dollars * 100;
const rs = (rupees: number) => rupees * 100;

describe("rates and conversion", () => {
  it("parses and formats rates", () => {
    expect(parseRate("300.25")).toBe(B(3_002_500));
    expect(parseRate("1,300")).toBe(B(13_000_000));
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("1.23456")).toBeNull();
    expect(formatRate(B(3_002_500))).toBe("300.25");
    expect(formatRate(B(3_000_000))).toBe("300");
  });

  it("converts with rounding to the nearest cent", () => {
    expect(toBase(B(usd(2000)), parseRate("300")!)).toBe(B(rs(600_000)));
    expect(toBase(B(1), parseRate("300.255")!)).toBe(B(300)); // $0.01 × 300.255 = Rs 3.00255 → 3.00
    expect(toBase(B(-usd(10)), parseRate("300")!)).toBe(B(-rs(3000)));
    expect(impliedRate(B(rs(315_000)), B(usd(1000)))).toBe(B(3_150_000));
  });

  it("values dollars going out at the average rate they were bought at", () => {
    const held = { book: B(rs(600_000 + 310_000)), foreign: B(usd(3000)) }; // $2,000 @ 300 + $1,000 @ 310
    expect(bookValueOut(held, B(usd(1500)), B(0))).toBe(B(rs(455_000))); // average 303.33…
    // Spending more than is held: the extra is valued at today's rate.
    expect(bookValueOut({ book: B(rs(30_000)), foreign: B(usd(100)) }, B(usd(150)), parseRate("320")!)).toBe(B(rs(30_000 + 16_000)));
  });

  it("finds the latest rate on or before a date", () => {
    const rates = [
      { currency: "USD", date: "2026-11-01", rate4: B(3_000_000) },
      { currency: "USD", date: "2026-11-20", rate4: B(3_100_000) },
      { currency: "EUR", date: "2026-11-25", rate4: B(3_300_000) },
    ];
    expect(rateOn(rates, "USD", "2026-11-25")?.rate4).toBe(B(3_100_000));
    expect(rateOn(rates, "USD", "2026-11-10")?.rate4).toBe(B(3_000_000));
    expect(rateOn(rates, "USD", "2026-10-31")).toBeNull();
  });
});

describe("building lines for a USD account", () => {
  const ctx = (held = { book: ZERO, foreign: ZERO }): FxContext => ({
    currencyOf: (id) => (id === "usd" ? "USD" : null),
    held: () => held,
    gainId: "gain",
    lossId: "loss",
    openingId: "opening",
  });

  it("salary into USD is income at the day's rate", () => {
    const lines = buildLines({ kind: "INCOME", date: "2026-12-01", amount: usd(2000), categoryId: "salary", accountId: "usd", rate: "300" }, ctx());
    expect(lines).toEqual([
      { accountId: "salary", amount: B(-rs(600_000)) },
      { accountId: "usd", amount: B(rs(600_000)), foreignAmount: B(usd(2000)) },
    ]);
  });

  it("converting at a better rate records an exchange gain", () => {
    const held = { book: B(rs(600_000)), foreign: B(usd(2000)) }; // bought at 300
    const lines = buildLines({ kind: "TRANSFER", date: "2027-01-10", amount: usd(1000), received: rs(315_000), fromId: "usd", toId: "bank" }, ctx(held));
    expect(sumLines(lines)).toBe(ZERO);
    expect(lines).toContainEqual({ accountId: "usd", amount: B(-rs(300_000)), foreignAmount: B(-usd(1000)) });
    expect(lines).toContainEqual({ accountId: "bank", amount: B(rs(315_000)) });
    expect(lines).toContainEqual({ accountId: "gain", amount: B(-rs(15_000)) });
  });

  it("converting at a worse rate records an exchange loss", () => {
    const held = { book: B(rs(600_000)), foreign: B(usd(2000)) };
    const lines = buildLines({ kind: "TRANSFER", date: "2027-01-10", amount: usd(1000), received: rs(290_000), fromId: "usd", toId: "bank" }, ctx(held));
    expect(lines).toContainEqual({ accountId: "loss", amount: B(rs(10_000)) });
    expect(sumLines(lines)).toBe(ZERO);
  });

  it("paying from USD costs the day's rate; the difference from cost is a gain or loss", () => {
    const held = { book: B(rs(600_000)), foreign: B(usd(2000)) };
    const lines = buildLines({ kind: "EXPENSE", date: "2027-01-10", amount: usd(100), categoryId: "fun", accountId: "usd", rate: "310" }, ctx(held));
    expect(lines).toContainEqual({ accountId: "fun", amount: B(rs(31_000)) });
    expect(lines).toContainEqual({ accountId: "usd", amount: B(-rs(30_000)), foreignAmount: B(-usd(100)) });
    expect(lines).toContainEqual({ accountId: "gain", amount: B(-rs(1_000)) });
  });

  it("buying dollars costs exactly what was paid", () => {
    const lines = buildLines({ kind: "TRANSFER", date: "2026-12-01", amount: rs(305_000), received: usd(1000), fromId: "bank", toId: "usd" }, ctx());
    expect(lines).toEqual([
      { accountId: "bank", amount: B(-rs(305_000)) },
      { accountId: "usd", amount: B(rs(305_000)), foreignAmount: B(usd(1000)) },
    ]);
  });

  it("asks for the rate or the amount received", () => {
    expect(() => buildLines({ kind: "INCOME", date: "2026-12-01", amount: usd(10), categoryId: "s", accountId: "usd" }, ctx())).toThrow(LedgerError);
    expect(() => buildLines({ kind: "TRANSFER", date: "2026-12-01", amount: usd(10), fromId: "usd", toId: "bank" }, ctx())).toThrow(LedgerError);
  });
});

describe("USD account end to end", () => {
  let db: UserDb;
  let id: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    const me = await prisma.user.create({ data: { name: "Me", email: "me@fx.test", passwordHash: "x" } });
    db = scopedDb(prisma, me.id);
    await ensureDefaultAccounts(db);
    await db.account.create({ data: { name: "USD savings", type: "ASSET", subtype: "SAVINGS", currency: "USD" } as never });
    const all = await db.account.findMany();
    id = Object.fromEntries(all.map((a) => [a.systemKey ?? a.name, a.id]));
  });
  beforeEach(async () => {
    await db.entryLine.deleteMany();
    await db.entry.deleteMany();
    await db.exchangeRate.deleteMany();
  });
  afterAll(() => resetDb());

  const sums = async (accountId: string) => {
    const r = await db.entryLine.aggregate({ where: { accountId }, _sum: { amount: true, foreignAmount: true } });
    return { book: r._sum.amount ?? ZERO, foreign: r._sum.foreignAmount ?? ZERO };
  };

  it("salary in, part converted later at a better rate, gain recorded, rates remembered", async () => {
    await saveEntry(db, { kind: "INCOME", date: "2026-12-01", amount: usd(2000), categoryId: id["Employment (Net)"], accountId: id["USD savings"], rate: "300" });
    const t = await saveEntry(db, { kind: "TRANSFER", date: "2027-01-10", amount: usd(1000), received: rs(315_000), fromId: id["USD savings"], toId: id["Bank account"] });

    expect(await sums(id["USD savings"])).toEqual({ book: B(rs(300_000)), foreign: B(usd(1000)) });
    expect((await sums(id.FX_GAIN)).book).toBe(B(-rs(15_000)));
    expect((await sums(id["Bank account"])).book).toBe(B(rs(315_000)));
    const rates = await db.exchangeRate.findMany({ orderBy: { date: "asc" } });
    expect(rates.map((r) => [r.date, formatRate(r.rate4)])).toEqual([
      ["2026-12-01", "300"],
      ["2027-01-10", "315"],
    ]);

    // Editing the conversion recalculates against what was held before it (not counting itself).
    await saveEntry(db, { kind: "TRANSFER", date: "2027-01-10", amount: usd(1000), received: rs(320_000), fromId: id["USD savings"], toId: id["Bank account"] }, t);
    expect((await sums(id.FX_GAIN)).book).toBe(B(-rs(20_000)));
    for (const e of await db.entry.findMany({ include: { lines: true } })) expect(sumLines(e.lines)).toBe(ZERO);
  });

  it("a personal backup restores the USD account, its dollars and the rates", async () => {
    await saveEntry(db, { kind: "INCOME", date: "2026-12-01", amount: usd(2000), categoryId: id["Employment (Net)"], accountId: id["USD savings"], rate: "300" });
    const me = await prisma.user.findFirstOrThrow({ where: { email: "me@fx.test" } });
    const other = await prisma.user.create({ data: { name: "New", email: "new@fx.test", passwordHash: "x" } });
    const fresh = scopedDb(prisma, other.id);
    await ensureDefaultAccounts(fresh);
    await restoreBackup(fresh, other.id, await exportBackup(db, me));
    const restored = await fresh.account.findFirstOrThrow({ where: { name: "USD savings" } });
    expect(restored.currency).toBe("USD");
    const held = await fresh.entryLine.aggregate({ where: { accountId: restored.id }, _sum: { amount: true, foreignAmount: true } });
    expect(held._sum).toEqual({ amount: B(rs(600_000)), foreignAmount: B(usd(2000)) });
    expect(await fresh.exchangeRate.count()).toBe(1);
  });

  it("refuses a USD transaction without a rate", async () => {
    await expect(saveEntry(db, { kind: "INCOME", date: "2026-12-01", amount: usd(10), categoryId: id["Employment (Net)"], accountId: id["USD savings"] })).rejects.toThrow(
      "exchange rate",
    );
  });
});

describe("reports with a USD savings account", () => {
  const line = (over: Partial<ReportLine>): ReportLine => ({
    date: "2026-12-01",
    kind: "INCOME",
    amount: ZERO,
    accountId: "x",
    type: "ASSET",
    subtype: null,
    systemKey: null,
    name: "x",
    currency: null,
    foreignAmount: null,
    ...over,
  });
  // $2,000 salary kept in a USD savings account, recorded at 300.
  const lines = [
    line({ accountId: "salary", type: "INCOME", amount: B(-rs(600_000)) }),
    line({ accountId: "usd", subtype: "SAVINGS", currency: "USD", amount: B(rs(600_000)), foreignAmount: B(usd(2000)) }),
  ];
  const rates = [
    { currency: "USD", date: "2026-12-01", rate4: B(3_000_000) },
    { currency: "USD", date: "2026-12-20", rate4: B(3_100_000) },
  ];

  it("counts a USD salary kept in USD savings as saved", () => {
    const f = flows(lines, "2026-12-01", "2026-12-31", null);
    expect(f.income).toBe(B(rs(600_000)));
    expect(f.movedToSavings).toBe(B(rs(600_000)));
  });

  it("values the dollars at the rate on the date", () => {
    expect(netWorthAt(lines, "2026-12-10", rates)).toBe(B(rs(600_000)));
    expect(netWorthAt(lines, "2026-12-31", rates)).toBe(B(rs(620_000))); // $2,000 × 310
    expect(netWorthAt(lines, "2026-12-31")).toBe(B(rs(600_000))); // no rates: what it cost
  });
});
