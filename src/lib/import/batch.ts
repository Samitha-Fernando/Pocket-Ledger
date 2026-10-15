import type { UserDb } from "@/lib/db/scoped";
import { isMoneyAccount } from "@/lib/ledger/accounts";
import { ASSET_CLASSES } from "@/lib/ledger/asset-classes";
import { createAsset } from "@/lib/ledger/assets";
import { deleteDebtMovement, makePayment } from "@/lib/ledger/debts";
import { LedgerError, saveEntry } from "@/lib/ledger/engine";
import { type Mapping, defaultMapping, mappingKey, planRow } from "./mapping";
import { type ParsedWorkbook, fingerprintAll } from "./parse";

/**
 * Import batches: stage spreadsheet rows (nothing posted), map and review them,
 * then post them as real transactions. Re-uploading skips rows already posted;
 * a whole batch can be undone.
 */

export const ROW_ACTIONS = ["EXPENSE", "INCOME", "TRANSFER", "ASSET", "DEBT_PAYMENT", "SKIP", "REVIEW"] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];

async function accountsLite(db: UserDb) {
  return db.account.findMany({ select: { id: true, name: true, type: true, subtype: true, isSystem: true, archived: true } });
}

/** Stages an uploaded workbook. Returns the batch id. */
export async function stageBatch(db: UserDb, fileName: string, parsed: ParsedWorkbook, assetThresholdCents: number) {
  if (parsed.rows.length === 0) throw new LedgerError("The sheet has no rows to import.");
  if (parsed.rows.length > 20_000) throw new LedgerError("That's too many rows for one import (max 20,000).");

  const accounts = await accountsLite(db);
  const keys = [...new Map(parsed.rows.map((r) => [mappingKey(r.type, r.category), { type: r.type, category: r.category }])).values()];
  const mapping = defaultMapping(keys, accounts);
  const money = accounts.filter((a) => isMoneyAccount(a) && !a.isSystem && !a.archived);
  const accountId = (money.find((a) => a.subtype === "BANK") ?? money[0])?.id ?? null;
  const dates = parsed.rows.map((r) => r.date).filter(Boolean).sort() as string[];
  const startingDate = dates[0] ? dayBefore(dates[0]) : null;

  // Rows already posted by an earlier upload are recognised and skipped.
  const prints = fingerprintAll(parsed.rows);
  const alreadyPosted = new Set(
    (await db.importRow.findMany({ where: { fingerprint: { in: prints }, entry: { isNot: null } }, select: { fingerprint: true } })).map((r) => r.fingerprint),
  );

  const batch = await db.importBatch.create({
    data: {
      fileName: fileName.slice(0, 200),
      mapping: JSON.stringify(mapping),
      accountId,
      startingBalance: BigInt(0),
      startingDate,
      lateIncomeDay: parsed.lateIncomeDay,
    } as never,
  });

  await db.importRow.createMany({
    data: parsed.rows.map((r, i) => {
      const duplicate = alreadyPosted.has(prints[i]);
      const plan = duplicate ? { action: "SKIP", targetId: null, note: "Already imported earlier." } : planRow(r, mapping, assetThresholdCents);
      return {
        batchId: batch.id,
        rowNumber: r.rowNumber,
        fingerprint: prints[i],
        raw: JSON.stringify(r.raw),
        date: r.date,
        type: r.type,
        category: r.category,
        amount: r.amount === null ? null : BigInt(r.amount),
        details: r.details,
        action: plan.action,
        targetId: plan.targetId,
        note: plan.note,
        duplicate,
        ...assetDefaults(plan.assetName),
      };
    }) as never,
  });
  return batch.id;
}

function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function assetDefaults(name: string | null | undefined) {
  return name ? { assetName: name, assetClass: "OTHER", lifeMonths: ASSET_CLASSES.OTHER.lifeMonths } : {};
}

async function loadStaged(db: UserDb, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new LedgerError("That import no longer exists.");
  if (batch.status !== "STAGED") throw new LedgerError("This import has already been posted or undone.");
  return batch;
}

/** Saves the account, starting balance and category mapping, and re-plans rows not changed by hand. */
export async function saveMapping(
  db: UserDb,
  batchId: string,
  input: { accountId: string; startingBalance: number; startingDate: string | null; mapping: Mapping },
  assetThresholdCents: number,
) {
  const batch = await loadStaged(db, batchId);
  const account = await db.account.findUnique({ where: { id: input.accountId } });
  if (!account || !isMoneyAccount(account) || account.isSystem) throw new LedgerError("Choose the account the spreadsheet tracked.");
  if (!Number.isSafeInteger(input.startingBalance)) throw new LedgerError("Enter a valid starting balance.");
  if (input.startingBalance !== 0 && !input.startingDate) throw new LedgerError("Choose the date of the starting balance.");

  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      accountId: input.accountId,
      startingBalance: BigInt(input.startingBalance),
      startingDate: input.startingDate,
      mapping: JSON.stringify(input.mapping),
    },
  });

  const rows = await db.importRow.findMany({ where: { batchId, manual: false, duplicate: false, entry: { is: null } } });
  for (const row of rows) {
    const plan = planRow(row, input.mapping, assetThresholdCents);
    await db.importRow.update({
      where: { id: row.id },
      data: {
        action: plan.action,
        targetId: plan.targetId,
        note: plan.note,
        ...(plan.action === "ASSET" ? assetDefaults(row.assetName ?? plan.assetName) : {}),
      },
    });
  }
}

export type RowPatch = {
  action?: RowAction;
  targetId?: string | null;
  assetName?: string | null;
  assetClass?: string | null;
  lifeMonths?: number | null;
  loanId?: string | null;
};

/** Changes one or more rows by hand (from the review screen). */
export async function updateRows(db: UserDb, batchId: string, rowIds: string[], patch: RowPatch) {
  await loadStaged(db, batchId);
  if (patch.action && !ROW_ACTIONS.includes(patch.action)) throw new LedgerError("Unknown action.");
  if (patch.assetClass && !(patch.assetClass in ASSET_CLASSES)) throw new LedgerError("Unknown asset class.");
  if (patch.lifeMonths != null && (!Number.isInteger(patch.lifeMonths) || patch.lifeMonths < 0 || patch.lifeMonths > 600)) {
    throw new LedgerError("Useful life must be between 0 and 50 years.");
  }
  const rows = await db.importRow.findMany({ where: { batchId, id: { in: rowIds }, entry: { is: null } } });
  for (const row of rows) {
    const action = patch.action ?? row.action;
    const becomesAsset = action === "ASSET" && row.action !== "ASSET";
    await db.importRow.update({
      where: { id: row.id },
      data: {
        action,
        manual: true,
        note: action === "REVIEW" ? row.note : null,
        ...(patch.targetId !== undefined && { targetId: patch.targetId }),
        ...(action === "ASSET" || action === "SKIP" || action === "REVIEW" ? { targetId: null } : {}),
        ...(becomesAsset && { assetName: row.details?.slice(0, 80) || row.category, assetClass: "OTHER", lifeMonths: ASSET_CLASSES.OTHER.lifeMonths }),
        ...(patch.assetName !== undefined && { assetName: patch.assetName }),
        ...(patch.assetClass !== undefined && { assetClass: patch.assetClass }),
        ...(patch.lifeMonths !== undefined && { lifeMonths: patch.lifeMonths }),
        ...(patch.loanId !== undefined && { loanId: patch.loanId }),
      },
    });
  }
  return rows.length;
}

/** Posts every staged row as a real transaction. Safe to run again after fixing errors. */
export async function postBatch(db: UserDb, batchId: string, today: string) {
  const batch = await loadStaged(db, batchId);
  if (!batch.accountId) throw new LedgerError("Choose the account the spreadsheet tracked (step 1).");
  const rows = await db.importRow.findMany({
    where: { batchId, entry: { is: null } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const undecided = rows.filter((r) => r.action === "REVIEW").length;
  if (undecided > 0) throw new LedgerError(`${undecided} row(s) still need a decision. Fix them on the Review step (or skip them).`);

  if (batch.startingBalance && batch.startingBalance !== BigInt(0) && !batch.openingEntryId) {
    const openingEntryId = await saveEntry(db, {
      kind: "OPENING_BALANCE",
      date: batch.startingDate!,
      amount: Number(batch.startingBalance),
      accountId: batch.accountId,
      details: `Starting balance (import of ${batch.fileName})`,
    });
    await db.importBatch.update({ where: { id: batchId }, data: { openingEntryId } });
  }

  const errors: { rowNumber: number; message: string }[] = [];
  let posted = 0;
  for (const row of rows) {
    if (row.action === "SKIP") continue;
    const amount = Number(row.amount);
    const base = { date: row.date!, amount, details: row.details };
    try {
      switch (row.action) {
        case "EXPENSE":
          await saveEntry(db, { kind: "EXPENSE", ...base, categoryId: row.targetId ?? "", accountId: batch.accountId }, undefined, { importRowId: row.id });
          break;
        case "INCOME":
          await saveEntry(db, { kind: "INCOME", ...base, categoryId: row.targetId ?? "", accountId: batch.accountId, loanId: row.loanId }, undefined, { importRowId: row.id });
          break;
        case "TRANSFER":
          await saveEntry(db, { kind: "TRANSFER", ...base, fromId: batch.accountId, toId: row.targetId ?? "" }, undefined, { importRowId: row.id });
          break;
        case "ASSET":
          await createAsset(
            db,
            {
              name: row.assetName || row.details || row.category,
              assetClass: row.assetClass ?? "OTHER",
              purchaseDate: row.date!,
              cost: amount,
              fundingAccountId: batch.accountId,
              usefulLifeMonths: row.lifeMonths ?? ASSET_CLASSES.OTHER.lifeMonths,
              residualValue: 0,
              details: row.details,
              importRowId: row.id,
            },
            today,
          );
          break;
        case "DEBT_PAYMENT":
          if (!row.targetId) throw new LedgerError("Choose the card or loan this paid.");
          await makePayment(
            db,
            row.targetId,
            { date: row.date!, principal: amount, interest: 0, fromAccountId: batch.accountId, details: row.details, importRowId: row.id },
            today,
          );
          break;
      }
      posted++;
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      errors.push({ rowNumber: row.rowNumber, message: err.message });
      await db.importRow.update({ where: { id: row.id }, data: { note: err.message } });
    }
  }

  if (errors.length === 0) {
    await db.importBatch.update({ where: { id: batchId }, data: { status: "POSTED", postedAt: new Date() } });
  }
  return { posted, errors };
}

/** Removes every transaction a batch created (and assets bought through it). */
export async function undoBatch(db: UserDb, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new LedgerError("That import no longer exists.");
  if (batch.status === "UNDONE") return 0;

  const entries = await db.entry.findMany({ where: { importRow: { batchId } } });
  for (const e of entries) {
    if (e.kind === "ASSET_PURCHASE" && e.assetId) {
      // An asset bought through the import goes completely (depreciation etc. too).
      const asset = await db.fixedAsset.findUnique({ where: { id: e.assetId } });
      await db.entry.deleteMany({ where: { assetId: e.assetId, kind: { in: ["ASSET_PURCHASE", "DEPRECIATION", "ASSET_REVALUATION", "ASSET_SALE"] } } });
      await db.entry.updateMany({ where: { assetId: e.assetId }, data: { assetId: null } });
      if (asset) {
        await db.fixedAsset.delete({ where: { id: asset.id } });
        await db.account.delete({ where: { id: asset.accountId } });
      }
    } else if (e.kind === "DEBT_PAYMENT" && e.debtId) {
      await deleteDebtMovement(db, e.id); // also updates the card / loan's status
    } else {
      await db.entry.deleteMany({ where: { id: e.id } });
    }
  }
  if (batch.openingEntryId) await db.entry.deleteMany({ where: { id: batch.openingEntryId } });
  await db.importBatch.update({ where: { id: batchId }, data: { status: "UNDONE", openingEntryId: null } });
  return entries.length;
}

/** Deletes a batch that hasn't been posted (or was undone). */
export async function deleteBatch(db: UserDb, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return;
  if (batch.status === "POSTED" || (await db.entry.count({ where: { importRow: { batchId } } })) > 0) {
    throw new LedgerError("Undo this import first.");
  }
  await db.importRow.deleteMany({ where: { batchId } });
  await db.importBatch.delete({ where: { id: batchId } });
}

/** Totals per "Type / Category": the spreadsheet vs what was (or will be) posted. */
export async function batchSummary(db: UserDb, batchId: string) {
  const rows = await db.importRow.findMany({
    where: { batchId },
    select: { type: true, category: true, amount: true, action: true, duplicate: true, entry: { select: { id: true } } },
  });
  const groups = new Map<string, { key: string; count: number; total: bigint; toPost: bigint; posted: bigint; skipped: number; review: number }>();
  for (const r of rows) {
    const key = mappingKey(r.type, r.category);
    const g = groups.get(key) ?? { key, count: 0, total: BigInt(0), toPost: BigInt(0), posted: BigInt(0), skipped: 0, review: 0 };
    const amt = r.amount ?? BigInt(0);
    g.count++;
    g.total += amt;
    if (r.action === "SKIP") g.skipped++;
    else if (r.action === "REVIEW") g.review++;
    else g.toPost += amt;
    if (r.entry) g.posted += amt;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
