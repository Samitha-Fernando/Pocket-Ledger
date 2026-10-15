import type { FixedAsset } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate } from "@/lib/format";
import { FIXED_SUBTYPE, canPayFrom, isMoneyAccount, systemAccount } from "./accounts";
import { LedgerError, type Line, type Tx, postEntry } from "./engine";

/**
 * Asset register: buying, monthly straight-line depreciation, value changes,
 * selling/scrapping, and converting between expense and asset.
 *
 * Each asset has its own ledger account; its balance IS the asset's current
 * (book) value. Depreciation is posted on the last day of each month as
 *   Asset account −X   /   Depreciation expense +X
 */

import { ASSET_CLASSES } from "./asset-classes";
export { ASSET_CLASSES, STATUS_LABELS, type AssetClass } from "./asset-classes";

const ZERO = BigInt(0);

// ---- Month arithmetic ("YYYY-MM") --------------------------------------------

export const monthOf = (date: string) => date.slice(0, 7);

export function monthIndex(month: string) {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

function monthFromIndex(i: number) {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** "2026-02" → "2026-02-28" */
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// ---- Pure depreciation maths -------------------------------------------------

/** Months of life left, counting `month` itself. The purchase month is month 1. */
export function remainingMonths(purchaseDate: string, lifeMonths: number, month: string) {
  return lifeMonths - (monthIndex(month) - monthIndex(monthOf(purchaseDate)));
}

/**
 * Straight-line: spread what's left to lose evenly over the months left.
 * Rounds down to the cent; the final month takes the remainder, so the value
 * lands exactly on the leftover (residual) value.
 */
export function monthlyDepreciation(book: bigint, residual: bigint, remaining: number) {
  if (remaining <= 0 || book <= residual) return ZERO;
  return (book - residual) / BigInt(remaining);
}

/** Months whose depreciation is due: the month has ended on or before `upTo`, within the asset's life. */
export function dueMonths(asset: Pick<FixedAsset, "purchaseDate" | "usefulLifeMonths">, upTo: string) {
  const first = monthIndex(monthOf(asset.purchaseDate));
  const lastInLife = first + asset.usefulLifeMonths - 1;
  const months: string[] = [];
  for (let i = first; i <= lastInLife; i++) {
    const m = monthFromIndex(i);
    if (monthEnd(m) > upTo) break;
    months.push(m);
  }
  return months;
}

// ---- Database helpers --------------------------------------------------------

/**
 * Value of an asset account at the end of `date`. For a depreciation month we
 * leave out value changes / sales dated that same day: those apply *after*
 * the month's depreciation.
 */
async function bookValue(tx: Tx, accountId: string, date: string, forDepreciation = false) {
  const result = await tx.entryLine.aggregate({
    where: {
      accountId,
      entry: {
        date: { lte: date },
        ...(forDepreciation && { NOT: { date, kind: { in: ["ASSET_REVALUATION", "ASSET_SALE"] } } }),
      },
    },
    _sum: { amount: true },
  });
  return result._sum.amount ?? ZERO;
}

export async function currentValue(tx: Tx, accountId: string) {
  const result = await tx.entryLine.aggregate({ where: { accountId }, _sum: { amount: true } });
  return result._sum.amount ?? ZERO;
}

/** Posts any missing monthly depreciation for one asset, up to `upTo`. Returns how many months were posted. */
export async function catchUpAsset(tx: Tx, asset: FixedAsset, upTo: string) {
  if (asset.usefulLifeMonths <= 0) return 0;
  const limit = asset.status !== "ACTIVE" && asset.disposedDate && asset.disposedDate < upTo ? asset.disposedDate : upTo;
  const months = dueMonths(asset, limit);
  if (months.length === 0) return 0;

  const posted = new Set(
    (await tx.entry.findMany({ where: { assetId: asset.id, kind: "DEPRECIATION" }, select: { depMonth: true } })).map(
      (e) => e.depMonth,
    ),
  );
  const todo = months.filter((m) => !posted.has(m));
  if (todo.length === 0) return 0;

  const depAccount = await systemAccount(tx, "DEPRECIATION");
  let count = 0;
  for (const month of todo) {
    const date = monthEnd(month);
    const book = await bookValue(tx, asset.accountId, date, true);
    const amount = monthlyDepreciation(book, asset.residualValue, remainingMonths(asset.purchaseDate, asset.usefulLifeMonths, month));
    if (amount <= ZERO) continue;
    await postEntry(tx, { kind: "DEPRECIATION", date, assetId: asset.id, depMonth: month, details: asset.name }, [
      { accountId: asset.accountId, amount: -amount },
      { accountId: depAccount.id, amount },
    ]);
    count++;
  }
  return count;
}

/** Brings every active asset's depreciation up to date. Safe to call on every page load. */
export async function catchUpAllAssets(db: UserDb, today: string) {
  const assets = await db.fixedAsset.findMany({ where: { status: "ACTIVE", usefulLifeMonths: { gt: 0 } } });
  if (assets.length === 0) return;

  // Skip assets that are already up to date (one cheap query for all of them).
  const latest = await db.entry.groupBy({
    by: ["assetId"],
    where: { kind: "DEPRECIATION", assetId: { in: assets.map((a) => a.id) } },
    _max: { depMonth: true },
  });
  const lastPosted = new Map(latest.map((r) => [r.assetId, r._max.depMonth]));

  for (const asset of assets) {
    const due = dueMonths(asset, today);
    if (due.length === 0 || lastPosted.get(asset.id) === due[due.length - 1]) continue;
    try {
      await db.$transaction((tx) => catchUpAsset(tx, asset, today));
    } catch (err) {
      // Two page loads at the same moment may race; the unique (asset, month) rule stops doubles.
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
}

/** Deletes and re-posts all depreciation, e.g. after the cost or a value change was edited. */
async function rebuildDepreciation(tx: Tx, asset: FixedAsset, today: string) {
  await tx.entry.deleteMany({ where: { assetId: asset.id, kind: "DEPRECIATION" } });
  await catchUpAsset(tx, asset, today);
}

async function loadAsset(tx: Tx, assetId: string) {
  const asset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new LedgerError("That asset no longer exists.");
  return asset;
}

async function moneyAccount(tx: Tx, id: string, label: string, allowCard = false) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || !(allowCard ? canPayFrom(account) : isMoneyAccount(account)) || account.isSystem || account.archived) {
    throw new LedgerError(`Choose a valid ${label}.`);
  }
  return account;
}

// ---- Buying / editing --------------------------------------------------------

export type AssetInput = {
  name: string;
  assetClass: string;
  purchaseDate: string;
  cost: number; // cents
  fundingAccountId: string;
  usefulLifeMonths: number;
  residualValue: number; // cents
  notes?: string | null;
  details?: string | null; // shown on the purchase transaction
  importRowId?: string | null; // spreadsheet row it came from
};

function validateAsset(input: AssetInput, today: string) {
  if (!input.name.trim()) throw new LedgerError("Give the asset a name.");
  if (input.name.length > 80) throw new LedgerError("Name is too long (max 80 characters).");
  if (!(input.assetClass in ASSET_CLASSES)) throw new LedgerError("Choose an asset class.");
  if (!isIsoDate(input.purchaseDate)) throw new LedgerError("Choose a valid purchase date.");
  if (input.purchaseDate > today) throw new LedgerError("The purchase date can't be in the future.");
  if (!Number.isSafeInteger(input.cost) || input.cost <= 0) throw new LedgerError("Cost must be more than zero.");
  if (!Number.isSafeInteger(input.residualValue) || input.residualValue < 0) throw new LedgerError("Leftover value can't be negative.");
  if (input.residualValue > input.cost) throw new LedgerError("Leftover value can't be more than the cost.");
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 0 || input.usefulLifeMonths > 600) {
    throw new LedgerError("Useful life must be between 0 and 50 years.");
  }
  if (input.notes && input.notes.length > 1000) throw new LedgerError("Notes are too long.");
}

/**
 * Records buying an asset: money moves from a cash/bank account into a new
 * asset account. Optionally replaces an existing expense ("convert to asset").
 */
export async function createAsset(db: UserDb, input: AssetInput, today: string, replaceExpenseId?: string) {
  validateAsset(input, today);
  return db.$transaction(async (tx) => {
    if (replaceExpenseId) {
      const old = await tx.entry.findUnique({ where: { id: replaceExpenseId } });
      if (!old || old.kind !== "EXPENSE") throw new LedgerError("That expense no longer exists.");
      await tx.entry.delete({ where: { id: old.id } });
    }
    await moneyAccount(tx, input.fundingAccountId, "account to pay from", true);

    const account = await tx.account.create({
      data: { name: input.name.trim(), type: "ASSET", subtype: FIXED_SUBTYPE } as never,
    });
    const asset = await tx.fixedAsset.create({
      data: {
        accountId: account.id,
        name: input.name.trim(),
        assetClass: input.assetClass,
        purchaseDate: input.purchaseDate,
        cost: BigInt(input.cost),
        residualValue: BigInt(input.residualValue),
        usefulLifeMonths: input.usefulLifeMonths,
        notes: input.notes?.trim() || null,
      } as never,
    });
    await postEntry(
      tx,
      { kind: "ASSET_PURCHASE", date: input.purchaseDate, assetId: asset.id, details: input.details ?? input.name, importRowId: input.importRowId },
      [
        { accountId: input.fundingAccountId, amount: BigInt(-input.cost) },
        { accountId: account.id, amount: BigInt(input.cost) },
      ],
    );
    await catchUpAsset(tx, asset, today);
    return asset.id;
  });
}

/** Edits an asset. Changing cost, date or life re-calculates all its depreciation. */
export async function updateAsset(db: UserDb, assetId: string, input: AssetInput, today: string) {
  validateAsset(input, today);
  return db.$transaction(async (tx) => {
    const asset = await loadAsset(tx, assetId);
    const financialChange =
      asset.purchaseDate !== input.purchaseDate ||
      asset.cost !== BigInt(input.cost) ||
      asset.residualValue !== BigInt(input.residualValue) ||
      asset.usefulLifeMonths !== input.usefulLifeMonths;
    const purchase = await tx.entry.findFirst({ where: { assetId, kind: "ASSET_PURCHASE" }, include: { lines: true } });
    const oldFunding = purchase?.lines.find((l) => l.accountId !== asset.accountId)?.accountId;
    const fundingChange = oldFunding !== input.fundingAccountId;

    if (asset.status !== "ACTIVE" && (financialChange || fundingChange)) {
      throw new LedgerError("Undo the sale first, then change the cost, date or life.");
    }

    const updated = await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        name: input.name.trim(),
        assetClass: input.assetClass,
        purchaseDate: input.purchaseDate,
        cost: BigInt(input.cost),
        residualValue: BigInt(input.residualValue),
        usefulLifeMonths: input.usefulLifeMonths,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.account.update({ where: { id: asset.accountId }, data: { name: input.name.trim() } });

    if (purchase && (financialChange || fundingChange)) {
      await moneyAccount(tx, input.fundingAccountId, "account to pay from", true);
      await tx.entry.delete({ where: { id: purchase.id } });
      await postEntry(
        tx,
        { kind: "ASSET_PURCHASE", date: input.purchaseDate, assetId, details: purchase.details ?? input.name },
        [
          { accountId: input.fundingAccountId, amount: BigInt(-input.cost) },
          { accountId: asset.accountId, amount: BigInt(input.cost) },
        ],
      );
    }
    if (financialChange) await rebuildDepreciation(tx, updated, today);
  });
}

// ---- Value changes -----------------------------------------------------------

/** Sets a new value on a date. The difference is posted as Gain/Loss on assets. */
export async function revalueAsset(db: UserDb, assetId: string, date: string, newValue: number, today: string, details?: string | null) {
  if (!isIsoDate(date) || date > today) throw new LedgerError("Choose a valid date (not in the future).");
  if (!Number.isSafeInteger(newValue) || newValue < 0) throw new LedgerError("Enter a valid value.");

  return db.$transaction(async (tx) => {
    const asset = await loadAsset(tx, assetId);
    if (asset.status !== "ACTIVE") throw new LedgerError("This asset has already been sold or scrapped.");
    if (date < asset.purchaseDate) throw new LedgerError("The date can't be before the purchase date.");

    await catchUpAsset(tx, asset, today);
    const book = await bookValue(tx, asset.accountId, date);
    const diff = BigInt(newValue) - book;
    if (diff === ZERO) throw new LedgerError("That's already its value on that date.");

    const gainOrLoss = await systemAccount(tx, diff > ZERO ? "ASSET_GAIN" : "ASSET_LOSS");
    await postEntry(tx, { kind: "ASSET_REVALUATION", date, assetId, details: details || "Value change" }, [
      { accountId: asset.accountId, amount: diff },
      { accountId: gainOrLoss.id, amount: -diff },
    ]);
    // Later months spread the new value over the life that's left.
    await rebuildDepreciation(tx, asset, today);
  });
}

export async function deleteRevaluation(db: UserDb, entryId: string, today: string) {
  return db.$transaction(async (tx) => {
    const entry = await tx.entry.findUnique({ where: { id: entryId } });
    if (!entry || entry.kind !== "ASSET_REVALUATION" || !entry.assetId) throw new LedgerError("That value change no longer exists.");
    const asset = await loadAsset(tx, entry.assetId);
    if (asset.status !== "ACTIVE") throw new LedgerError("Undo the sale first.");
    await tx.entry.delete({ where: { id: entryId } });
    await rebuildDepreciation(tx, asset, today);
  });
}

// ---- Selling / scrapping -----------------------------------------------------

export type SaleInput = {
  date: string;
  price: number; // cents; 0 when scrapped or given away
  accountId?: string | null; // where the money went (needed when price > 0)
  status: "SOLD" | "DISPOSED";
  details?: string | null;
};

/** Sale lines: remove the asset at its value, add the money received, book the difference. Pure. */
export function saleLines(
  ids: { asset: string; money?: string | null; gain: string; loss: string },
  book: bigint,
  price: bigint,
): Line[] {
  const diff = price - book;
  const lines: Line[] = [
    { accountId: ids.asset, amount: -book },
    ...(price > ZERO ? [{ accountId: ids.money!, amount: price }] : []),
    diff > ZERO ? { accountId: ids.gain, amount: -diff } : { accountId: ids.loss, amount: -diff },
  ];
  return lines.filter((l) => l.amount !== ZERO);
}

export async function sellAsset(db: UserDb, assetId: string, input: SaleInput, today: string) {
  if (!isIsoDate(input.date) || input.date > today) throw new LedgerError("Choose a valid date (not in the future).");
  if (!Number.isSafeInteger(input.price) || input.price < 0) throw new LedgerError("Enter a valid price.");

  return db.$transaction(async (tx) => {
    const asset = await loadAsset(tx, assetId);
    if (asset.status !== "ACTIVE") throw new LedgerError("This asset has already been sold or scrapped.");
    if (input.date < asset.purchaseDate) throw new LedgerError("The date can't be before the purchase date.");
    const later = await tx.entry.count({ where: { assetId, kind: "ASSET_REVALUATION", date: { gt: input.date } } });
    if (later > 0) throw new LedgerError("There's a value change after this date. Remove it first.");

    let moneyId: string | null = null;
    if (input.price > 0) {
      if (!input.accountId) throw new LedgerError("Choose the account the money went into.");
      moneyId = (await moneyAccount(tx, input.accountId, "account the money went into")).id;
    }

    // Depreciation runs up to the sale date and stops there.
    await tx.entry.deleteMany({ where: { assetId, kind: "DEPRECIATION", date: { gt: input.date } } });
    await catchUpAsset(tx, asset, input.date);

    const book = await bookValue(tx, asset.accountId, input.date);
    const [gain, loss] = await Promise.all([systemAccount(tx, "ASSET_GAIN"), systemAccount(tx, "ASSET_LOSS")]);
    const lines = saleLines({ asset: asset.accountId, money: moneyId, gain: gain.id, loss: loss.id }, book, BigInt(input.price));
    if (lines.length >= 2) {
      const label = input.status === "SOLD" ? "Sold" : "Scrapped / given away";
      await postEntry(tx, { kind: "ASSET_SALE", date: input.date, assetId, details: input.details || `${label}: ${asset.name}` }, lines);
    }
    await tx.fixedAsset.update({ where: { id: assetId }, data: { status: input.status, disposedDate: input.date } });
  });
}

export async function undoSale(db: UserDb, assetId: string, today: string) {
  return db.$transaction(async (tx) => {
    const asset = await loadAsset(tx, assetId);
    if (asset.status === "ACTIVE") return;
    await tx.entry.deleteMany({ where: { assetId, kind: "ASSET_SALE" } });
    const active = await tx.fixedAsset.update({ where: { id: assetId }, data: { status: "ACTIVE", disposedDate: null } });
    await catchUpAsset(tx, active, today);
  });
}

// ---- Asset ↔ expense ---------------------------------------------------------

/**
 * Turns an asset back into a plain expense: removes its depreciation and
 * value changes, and records the original purchase as an expense instead.
 * Repairs that were linked to it stay, just unlinked. Returns the photo file to delete.
 */
export async function convertAssetToExpense(db: UserDb, assetId: string, categoryId: string) {
  return db.$transaction(async (tx) => {
    const asset = await loadAsset(tx, assetId);
    if (asset.status !== "ACTIVE") throw new LedgerError("Undo the sale first.");
    const category = await tx.account.findUnique({ where: { id: categoryId } });
    if (!category || category.type !== "EXPENSE" || category.isSystem || category.archived) {
      throw new LedgerError("Choose a valid expense category.");
    }
    const purchase = await tx.entry.findFirst({ where: { assetId, kind: "ASSET_PURCHASE" }, include: { lines: true } });
    const funding = purchase?.lines.find((l) => l.accountId !== asset.accountId);
    if (!purchase || !funding) throw new LedgerError("Couldn't find the original purchase.");

    await tx.entry.deleteMany({ where: { assetId, kind: { in: ["ASSET_PURCHASE", "DEPRECIATION", "ASSET_REVALUATION"] } } });
    await tx.entry.updateMany({ where: { assetId }, data: { assetId: null } });
    await tx.fixedAsset.delete({ where: { id: assetId } });
    await tx.account.delete({ where: { id: asset.accountId } });

    const amount = -funding.amount;
    const entryId = await postEntry(tx, { kind: "EXPENSE", date: asset.purchaseDate, details: purchase.details }, [
      { accountId: funding.accountId, amount: -amount },
      { accountId: categoryId, amount },
    ]);
    return { entryId, photoPath: asset.photoPath };
  });
}

// ---- Reading -----------------------------------------------------------------

/** Everything the asset page shows: value, schedule (past + projected), repairs, true cost. */
export async function getAssetDetails(db: UserDb, assetId: string) {
  const asset = await db.fixedAsset.findUnique({ where: { id: assetId } });
  if (!asset) return null;

  const [value, entries] = await Promise.all([
    currentValue(db, asset.accountId),
    db.entry.findMany({
      where: { assetId },
      include: { lines: { include: { account: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const amountOn = (e: (typeof entries)[number]) =>
    e.lines.filter((l) => l.accountId === asset.accountId).reduce((s, l) => s + l.amount, ZERO);

  const depreciation = entries.filter((e) => e.kind === "DEPRECIATION");
  const revaluations = entries.filter((e) => e.kind === "ASSET_REVALUATION");
  const sale = entries.find((e) => e.kind === "ASSET_SALE");
  const repairs = entries.filter((e) => e.kind === "EXPENSE");
  const repairsTotal = repairs.reduce(
    (s, e) => s + e.lines.filter((l) => l.amount > ZERO).reduce((t, l) => t + l.amount, ZERO),
    ZERO,
  );
  const depreciationTotal = depreciation.reduce((s, e) => s - amountOn(e), ZERO);
  const saleProceeds = sale
    ? sale.lines.filter((l) => l.account.type === "ASSET" && l.accountId !== asset.accountId).reduce((s, l) => s + l.amount, ZERO)
    : ZERO;

  // Schedule: posted months, then a projection of the months still to come.
  let running = asset.cost;
  const schedule: { month: string; amount: bigint; valueAfter: bigint; projected: boolean }[] = [];
  for (const e of entries.filter((x) => x.kind !== "EXPENSE")) {
    const amt = amountOn(e);
    if (e.kind === "ASSET_PURCHASE") continue;
    running += amt;
    if (e.kind === "DEPRECIATION") schedule.push({ month: e.depMonth!, amount: -amt, valueAfter: running, projected: false });
  }
  if (asset.status === "ACTIVE" && asset.usefulLifeMonths > 0) {
    const last = depreciation.at(-1)?.depMonth;
    let i = last ? monthIndex(last) + 1 : monthIndex(monthOf(asset.purchaseDate));
    let book = value;
    for (;;) {
      const month = monthFromIndex(i);
      const remaining = remainingMonths(asset.purchaseDate, asset.usefulLifeMonths, month);
      if (remaining <= 0) break;
      const amount = monthlyDepreciation(book, asset.residualValue, remaining);
      if (amount <= ZERO) break;
      book -= amount;
      schedule.push({ month, amount, valueAfter: book, projected: true });
      i++;
    }
  }

  return {
    asset,
    value,
    depreciationTotal,
    repairs,
    repairsTotal,
    revaluations: revaluations.map((e) => ({ id: e.id, date: e.date, amount: amountOn(e), details: e.details })),
    sale: sale ? { id: sale.id, date: sale.date, proceeds: saleProceeds } : null,
    // What owning it has really cost: price + repairs − what it's worth now (or what you sold it for).
    trueCost: asset.cost + repairsTotal - (asset.status === "ACTIVE" ? value : saleProceeds),
    schedule,
    monthlyNow: schedule.find((s) => s.projected)?.amount ?? ZERO,
  };
}
