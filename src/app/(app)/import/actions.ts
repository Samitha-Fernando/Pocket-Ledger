"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AccountType } from "@/generated/prisma/client";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { prisma } from "@/lib/db/client";
import type { UserDb } from "@/lib/db/scoped";
import { parseMoneyToCents, todayIso } from "@/lib/format";
import { type RowPatch, deleteBatch, postBatch, saveMapping, stageBatch, undoBatch, updateRows } from "@/lib/import/batch";
import { type Mapping, type Target, decodeTarget, normalise } from "@/lib/import/mapping";
import { ImportError, parseWorkbook } from "@/lib/import/parse";
import { LedgerError } from "@/lib/ledger/engine";

export type ImportFormState = { error?: string; success?: string } | undefined;

const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (err) {
    if (err instanceof LedgerError || err instanceof ImportError) return { error: err.message };
    throw err;
  }
}

/** Upload: read the spreadsheet in memory (the file itself is never stored) and stage its rows. */
export async function uploadAction(_prev: ImportFormState, fd: FormData): Promise<ImportFormState> {
  const { user, db } = await getLedger();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose your .xlsx file." };
  if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max 5 MB)." };
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return { error: "Please upload an Excel file (.xlsx)." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // .xlsx / .xlsm
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf; // old .xls
  if (!isZip && !isOle) return { error: "That doesn't look like an Excel file." };

  const result = await attempt(() => stageBatch(db, file.name, parseWorkbook(Buffer.from(bytes)), user.assetThresholdCents));
  if ("error" in result) return { error: result.error };
  await audit(user.id, "import_uploaded", file.name);
  redirect(`/import/${result.ok}?step=mapping`);
}

/** A "create new …" choice on the mapping screen: reuse a same-named account or create it. */
async function ensureAccount(db: UserDb, type: AccountType, name: string, subtype: string | null) {
  const existing = (await db.account.findMany({ where: { type } })).find((a) => normalise(a.name) === normalise(name) && !a.isSystem);
  if (existing) return existing.id;
  return (await db.account.create({ data: { name: name.slice(0, 60), type, subtype } as never })).id;
}

export async function saveMappingAction(_prev: ImportFormState, fd: FormData): Promise<ImportFormState> {
  const { user, db } = await getLedger();
  const batchId = field(fd, "batchId");
  const startingBalance = parseMoneyToCents(field(fd, "startingBalance") || "0");
  if (startingBalance === null) return { error: "Enter a valid starting balance, e.g. 0 or 25,000" };

  const mapping: Mapping = {};
  for (const [name, value] of fd.entries()) {
    if (!name.startsWith("map::") || typeof value !== "string") continue;
    const key = name.slice(5);
    const category = key.split(" / ").slice(1).join(" / ");
    let target: Target | null;
    if (value === "NEW_EXPENSE") target = { action: "EXPENSE", targetId: await ensureAccount(db, "EXPENSE", category, null) };
    else if (value === "NEW_INCOME") target = { action: "INCOME", targetId: await ensureAccount(db, "INCOME", category, null) };
    else if (value === "NEW_SAVINGS") target = { action: "TRANSFER", targetId: await ensureAccount(db, "ASSET", category, "SAVINGS") };
    else target = decodeTarget(value);
    if (!target) return { error: `Choose what "${key}" should become.` };
    mapping[key] = target;
  }

  const result = await attempt(() =>
    saveMapping(
      db,
      batchId,
      { accountId: field(fd, "accountId"), startingBalance, startingDate: field(fd, "startingDate") || null, mapping },
      user.assetThresholdCents,
    ),
  );
  if ("error" in result) return { error: result.error };

  // "Late income shift" from the spreadsheet's Settings → your setting for reports.
  if (field(fd, "useLateIncome") === "on") {
    const day = Number(field(fd, "lateIncomeDay"));
    if (Number.isInteger(day) && day >= 1 && day <= 31) await prisma.user.update({ where: { id: user.id }, data: { lateIncomeDay: day } });
  }
  revalidatePath(`/import/${batchId}`);
  redirect(`/import/${batchId}?step=review`);
}

/** Change rows from the review screen (called directly from the browser). */
export async function updateRowsAction(batchId: string, rowIds: string[], patch: RowPatch) {
  const { db } = await getLedger();
  if (rowIds.length === 0) return { error: "Select at least one row." };
  const result = await attempt(() => updateRows(db, batchId, rowIds.slice(0, 5000), patch));
  revalidatePath(`/import/${batchId}`);
  return "error" in result ? { error: result.error } : { success: `Updated ${result.ok} row(s).` };
}

export async function postAction(_prev: ImportFormState, fd: FormData): Promise<ImportFormState> {
  const { user, db } = await getLedger();
  const batchId = field(fd, "batchId");
  const result = await attempt(() => postBatch(db, batchId, todayIso(user.timezone)));
  if ("error" in result) return { error: result.error };
  const { posted, errors } = result.ok;
  await audit(user.id, "import_posted", `${posted} rows`);
  revalidatePath("/", "layout");
  if (errors.length > 0) {
    return {
      error: `Posted ${posted} row(s), but ${errors.length} couldn't be posted: ${errors
        .slice(0, 5)
        .map((e) => `row ${e.rowNumber}: ${e.message}`)
        .join("; ")}${errors.length > 5 ? "…" : ""}. Fix them on the Review step and post again.`,
    };
  }
  return { success: `Posted ${posted} transactions.` };
}

export async function undoAction(fd: FormData) {
  const { user, db } = await getLedger();
  const batchId = field(fd, "batchId");
  const result = await attempt(() => undoBatch(db, batchId));
  if ("ok" in result) await audit(user.id, "import_undone", `${result.ok} transactions removed`);
  revalidatePath("/", "layout");
}

export async function deleteBatchAction(fd: FormData) {
  const { user, db } = await getLedger();
  const result = await attempt(() => deleteBatch(db, field(fd, "batchId")));
  if ("ok" in result) await audit(user.id, "import_deleted");
  revalidatePath("/import");
  redirect("/import");
}
