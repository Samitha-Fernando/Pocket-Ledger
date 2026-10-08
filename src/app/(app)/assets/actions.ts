"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { formatMoney, parseMoneyToCents, todayIso } from "@/lib/format";
import {
  type AssetInput,
  convertAssetToExpense,
  createAsset,
  deleteRevaluation,
  revalueAsset,
  sellAsset,
  undoSale,
  updateAsset,
} from "@/lib/ledger/assets";
import { LedgerError } from "@/lib/ledger/engine";
import { deletePhoto, fileFrom, savePhoto } from "@/lib/uploads";

export type AssetFormState = { error?: string; success?: string } | undefined;

function readAssetInput(fd: FormData): AssetInput | string {
  const cost = parseMoneyToCents(field(fd, "amount"));
  if (cost === null) return "Enter a valid price, e.g. 180,000";
  const residualText = field(fd, "residualValue");
  const residualValue = residualText ? parseMoneyToCents(residualText) : 0;
  if (residualValue === null) return "Enter a valid leftover value, or leave it blank.";
  const years = Number(field(fd, "lifeYears"));
  if (!Number.isFinite(years)) return "Enter the useful life in years.";

  return {
    name: field(fd, "assetName"),
    assetClass: field(fd, "assetClass"),
    purchaseDate: field(fd, "date"),
    cost,
    fundingAccountId: field(fd, "accountId"),
    usefulLifeMonths: Math.round(years * 12),
    residualValue,
    notes: field(fd, "notes") || null,
    details: field(fd, "details") || null,
  };
}

/** Wraps an action so LedgerError messages come back to the form. */
async function attempt(fn: () => Promise<void>): Promise<AssetFormState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return undefined;
}

/** Buy an asset (from the Add form's "Record as asset" switch or the Assets page). */
export async function createAssetAction(_prev: AssetFormState, fd: FormData): Promise<AssetFormState> {
  const { user, db } = await getLedger();
  const input = readAssetInput(fd);
  if (typeof input === "string") return { error: input };
  const replaceExpenseId = field(fd, "fromEntryId") || undefined;
  const photo = fileFrom(fd, "photo");

  let photoName: string | undefined;
  if (photo) {
    const saved = await savePhoto(user.id, photo);
    if ("error" in saved) return { error: saved.error };
    photoName = saved.name;
  }

  let assetId = "";
  const result = await attempt(async () => {
    assetId = await createAsset(db, input, todayIso(user.timezone), replaceExpenseId);
  });
  if (result?.error) {
    await deletePhoto(photoName);
    return result;
  }
  if (photoName) await db.fixedAsset.update({ where: { id: assetId }, data: { photoPath: photoName } });

  await audit(user.id, replaceExpenseId ? "asset_converted_from_expense" : "asset_bought", `${input.name} ${formatMoney(input.cost, user.currency)}`);
  revalidatePath("/", "layout");
  redirect(`/assets/${assetId}`);
}

export async function updateAssetAction(_prev: AssetFormState, fd: FormData): Promise<AssetFormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "assetId");
  const input = readAssetInput(fd);
  if (typeof input === "string") return { error: input };
  const existing = await db.fixedAsset.findUnique({ where: { id } });
  if (!existing) return { error: "That asset no longer exists." };

  const photo = fileFrom(fd, "photo");
  let photoName: string | undefined;
  if (photo) {
    const saved = await savePhoto(user.id, photo);
    if ("error" in saved) return { error: saved.error };
    photoName = saved.name;
  }

  const result = await attempt(() => updateAsset(db, id, input, todayIso(user.timezone)));
  if (result?.error) {
    await deletePhoto(photoName);
    return result;
  }
  if (photoName) {
    await db.fixedAsset.update({ where: { id }, data: { photoPath: photoName } });
    await deletePhoto(existing.photoPath);
  }
  await audit(user.id, "asset_updated", input.name);
  revalidatePath("/", "layout");
  redirect(`/assets/${id}`);
}

export async function removePhotoAction(fd: FormData) {
  const { db } = await getLedger();
  const id = field(fd, "assetId");
  const asset = await db.fixedAsset.findUnique({ where: { id } });
  if (!asset) return;
  await db.fixedAsset.update({ where: { id }, data: { photoPath: null } });
  await deletePhoto(asset.photoPath);
  revalidatePath(`/assets/${id}`);
}

export async function revalueAction(_prev: AssetFormState, fd: FormData): Promise<AssetFormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "assetId");
  const value = parseMoneyToCents(field(fd, "value"));
  if (value === null) return { error: "Enter a valid value, e.g. 120,000" };
  const result = await attempt(() => revalueAsset(db, id, field(fd, "date"), value, todayIso(user.timezone), field(fd, "details") || null));
  if (result?.error) return result;
  await audit(user.id, "asset_revalued", formatMoney(value, user.currency));
  revalidatePath("/", "layout");
  return { success: "Value updated." };
}

export async function deleteRevaluationAction(fd: FormData) {
  const { user, db } = await getLedger();
  await attempt(() => deleteRevaluation(db, field(fd, "entryId"), todayIso(user.timezone)));
  await audit(user.id, "asset_revaluation_removed");
  revalidatePath("/", "layout");
}

export async function sellAction(_prev: AssetFormState, fd: FormData): Promise<AssetFormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "assetId");
  const status = field(fd, "status") === "DISPOSED" ? "DISPOSED" : "SOLD";
  const priceText = field(fd, "price");
  const price = status === "DISPOSED" && !priceText ? 0 : parseMoneyToCents(priceText);
  if (price === null) return { error: "Enter a valid price, e.g. 95,000" };

  const result = await attempt(() =>
    sellAsset(
      db,
      id,
      { date: field(fd, "date"), price, accountId: field(fd, "accountId") || null, status, details: field(fd, "details") || null },
      todayIso(user.timezone),
    ),
  );
  if (result?.error) return result;
  await audit(user.id, status === "SOLD" ? "asset_sold" : "asset_disposed", formatMoney(price, user.currency));
  revalidatePath("/", "layout");
  return { success: status === "SOLD" ? "Recorded as sold." : "Recorded as scrapped / given away." };
}

export async function undoSaleAction(fd: FormData) {
  const { user, db } = await getLedger();
  await undoSale(db, field(fd, "assetId"), todayIso(user.timezone));
  await audit(user.id, "asset_sale_undone");
  revalidatePath("/", "layout");
}

export async function convertToExpenseAction(_prev: AssetFormState, fd: FormData): Promise<AssetFormState> {
  const { user, db } = await getLedger();
  let entryId = "";
  let photoPath: string | null = null;
  const result = await attempt(async () => {
    ({ entryId, photoPath } = await convertAssetToExpense(db, field(fd, "assetId"), field(fd, "categoryId")));
  });
  if (result?.error) return result;
  await deletePhoto(photoPath);
  await audit(user.id, "asset_converted_to_expense");
  revalidatePath("/", "layout");
  redirect(`/history/${entryId}`);
}
