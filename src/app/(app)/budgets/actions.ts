"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { parseMoneyToCents } from "@/lib/format";
import { applyDraft, saveDraft } from "@/lib/import/budget-draft";
import { parseBudgetSheet } from "@/lib/import/budget-sheet";
import { ImportError } from "@/lib/import/parse";
import { copyMonth, copyYear, fillYear, setBudget } from "@/lib/ledger/budgets";
import { LedgerError } from "@/lib/ledger/engine";

export type BudgetActionResult = { error?: string; success?: string } | undefined;

async function attempt(fn: () => Promise<unknown>): Promise<BudgetActionResult> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof LedgerError || err instanceof ImportError) return { error: err.message };
    throw err;
  }
  revalidatePath("/", "layout");
  return undefined;
}

/** "" or "0" clears the cell. */
function cents(text: string) {
  return text.trim() === "" ? 0 : parseMoneyToCents(text);
}

/** One cell of the budget grid (called directly from the browser). */
export async function setBudgetAction(month: string, key: string, text: string): Promise<BudgetActionResult> {
  const { db } = await getLedger();
  const value = cents(text);
  if (value === null) return { error: "Enter an amount like 25,000 (or leave it empty)." };
  return attempt(() => setBudget(db, month, key, value));
}

export async function fillYearAction(year: number, key: string, text: string): Promise<BudgetActionResult> {
  const { db } = await getLedger();
  const value = cents(text);
  if (value === null) return { error: "Enter an amount like 25,000." };
  return attempt(() => fillYear(db, year, key, value));
}

export async function copyMonthAction(from: string, to: string): Promise<BudgetActionResult> {
  const { db } = await getLedger();
  return attempt(() => copyMonth(db, from, to));
}

export async function copyYearAction(from: number, to: number): Promise<BudgetActionResult> {
  const { user, db } = await getLedger();
  const result = await attempt(() => copyYear(db, from, to));
  if (!result?.error) await audit(user.id, "budget_year_copied", `${from} → ${to}`);
  return result;
}

/** Upload: read the Budget Planning sheet into a private draft for preview. */
export async function uploadBudgetAction(_prev: BudgetActionResult, fd: FormData): Promise<BudgetActionResult> {
  const { db } = await getLedger();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose your .xlsx file." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is too large (max 5 MB)." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b) && !(bytes[0] === 0xd0 && bytes[1] === 0xcf)) return { error: "That doesn't look like an Excel file." };

  let draftId = "";
  const result = await attempt(async () => {
    draftId = await saveDraft(db, file.name, parseBudgetSheet(Buffer.from(bytes)));
  });
  if (result?.error) return result;
  redirect(`/budgets/import/${draftId}`);
}

export async function applyBudgetDraftAction(_prev: BudgetActionResult, fd: FormData): Promise<BudgetActionResult> {
  const { user, db } = await getLedger();
  const draftId = field(fd, "draftId");
  const count = Number(field(fd, "count"));
  const targets = Array.from({ length: Number.isInteger(count) ? Math.min(count, 500) : 0 }, (_, i) => field(fd, `line-${i}`) || null);
  let saved = 0;
  const result = await attempt(async () => {
    saved = await applyDraft(db, draftId, targets);
  });
  if (result?.error) return result;
  await audit(user.id, "budget_imported", `${saved} monthly amounts`);
  redirect("/budgets?imported=1");
}
