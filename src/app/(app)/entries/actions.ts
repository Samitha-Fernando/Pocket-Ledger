"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { historyHref } from "../history/remember";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { type EntryInput, LedgerError, deleteEntry, saveEntry } from "@/lib/ledger/engine";
import { formatMoney, parseMoneyToCents } from "@/lib/format";
import { createAssetAction } from "../assets/actions";

export type EntryFormState = { error?: string; success?: string; savedAt?: number } | undefined;

function readEntry(fd: FormData): EntryInput | string {
  const kind = field(fd, "kind");
  const amount = parseMoneyToCents(field(fd, "amount"));
  if (amount === null) return "Enter a valid amount, e.g. 1,250.50";
  const date = field(fd, "date");
  const details = field(fd, "details") || null;
  // Foreign-currency accounts: the exchange rate, or (transfers) the amount that arrived.
  const rate = field(fd, "rate") || null;
  const receivedText = field(fd, "received");
  const received = receivedText ? parseMoneyToCents(receivedText) : null;
  if (receivedText && received === null) return "Enter a valid amount received, e.g. 315,000";

  switch (kind) {
    case "INCOME":
      return {
        kind,
        date,
        amount,
        details,
        categoryId: field(fd, "categoryId"),
        accountId: field(fd, "accountId"),
        loanId: field(fd, "linkedLoanId") || null,
        rate,
      };
    case "EXPENSE":
      return {
        kind,
        date,
        amount,
        details,
        categoryId: field(fd, "categoryId"),
        accountId: field(fd, "accountId"),
        assetId: field(fd, "linkedAssetId") || null,
        rate,
      };
    case "TRANSFER":
      return { kind, date, amount, details, fromId: field(fd, "fromId"), toId: field(fd, "toId"), received };
    case "OPENING_BALANCE":
      return { kind, date, amount, details, accountId: field(fd, "accountId"), rate };
    default:
      return "Unknown transaction type.";
  }
}

/** Saves a new transaction, or updates one when the form has an `entryId`. */
export async function saveEntryAction(prev: EntryFormState, fd: FormData): Promise<EntryFormState> {
  // "Record as asset" switched on: this purchase goes to the asset register instead.
  if (field(fd, "kind") === "ASSET_PURCHASE") return createAssetAction(prev, fd);

  const { user, db } = await getLedger();
  const input = readEntry(fd);
  if (typeof input === "string") return { error: input };
  const entryId = field(fd, "entryId") || undefined;

  try {
    await saveEntry(db, input, entryId);
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }

  // Amounts are in the money account's currency (e.g. USD for a USD account).
  const moneyId = input.kind === "TRANSFER" ? input.fromId : input.accountId;
  const shownIn = (await db.account.findUnique({ where: { id: moneyId }, select: { currency: true } }))?.currency ?? user.currency;
  const summary = `${input.kind.toLowerCase().replace("_", " ")} ${formatMoney(input.amount, shownIn)} on ${input.date}`;
  await audit(user.id, entryId ? "entry_updated" : "entry_created", summary);
  revalidatePath("/", "layout");

  if (entryId) redirect(await historyHref(user.id, input.date.slice(0, 7)));
  return { success: `Saved ${formatMoney(input.amount, shownIn)}.`, savedAt: Date.now() };
}

export async function deleteEntryAction(fd: FormData) {
  const { user, db } = await getLedger();
  const id = field(fd, "entryId");
  const entry = await db.entry.findUnique({ where: { id } });
  if (entry) {
    await deleteEntry(db, id);
    await audit(user.id, "entry_deleted", `${entry.kind.toLowerCase().replace("_", " ")} on ${entry.date}`);
  }
  revalidatePath("/", "layout");
  redirect(await historyHref(user.id, entry?.date.slice(0, 7)));
}
