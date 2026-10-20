import type { UserDb } from "@/lib/db/scoped";
import { LedgerError } from "@/lib/ledger/engine";
import { getBudgetLines, setBudget } from "@/lib/ledger/budgets";
import type { SheetBudgetLine } from "./budget-sheet";

/**
 * Budget import in two steps: the sheet is read into a private draft (preview),
 * then, once you've checked where each line goes, saved as budgets. Months in the
 * sheet replace the same months already budgeted for that line.
 */

export async function saveDraft(db: UserDb, fileName: string, lines: SheetBudgetLine[]) {
  if (lines.length === 0) throw new LedgerError("No budget lines were found in the sheet.");
  await db.budgetDraft.deleteMany({}); // keep only the latest draft
  const draft = await db.budgetDraft.create({ data: { fileName: fileName.slice(0, 200), data: JSON.stringify(lines) } as never });
  return draft.id;
}

export async function loadDraft(db: UserDb, draftId: string) {
  const draft = await db.budgetDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new LedgerError("That budget import has expired. Please upload the file again.");
  return { ...draft, lines: JSON.parse(draft.data) as SheetBudgetLine[] };
}

/** Months in the draft that already have a budget (for the "will replace" warning). */
export async function monthsAlreadyBudgeted(db: UserDb, lines: SheetBudgetLine[]) {
  const months = [...new Set(lines.flatMap((l) => Object.keys(l.values)))];
  const existing = await db.budget.findMany({ where: { month: { in: months } }, select: { month: true }, distinct: ["month"] });
  return existing.map((e) => e.month).sort();
}

/**
 * Saves the draft. `targets[i]` is the budget line key for sheet line i, or null to skip.
 * Two sheet lines pointing at the same app line are added together.
 */
export async function applyDraft(db: UserDb, draftId: string, targets: (string | null)[]) {
  const draft = await loadDraft(db, draftId);
  const valid = new Set((await getBudgetLines(db)).map((l) => l.key));
  const combined = new Map<string, Map<string, number>>();
  draft.lines.forEach((line, i) => {
    const key = targets[i];
    if (!key) return;
    if (!valid.has(key)) throw new LedgerError(`Choose where “${line.label}” goes.`);
    const months = combined.get(key) ?? new Map<string, number>();
    for (const [m, cents] of Object.entries(line.values)) months.set(m, (months.get(m) ?? 0) + cents);
    combined.set(key, months);
  });

  // Replace: clear the months in the sheet for each imported line, then set the new amounts.
  const sheetMonths = [...new Set(draft.lines.flatMap((l) => Object.keys(l.values)))];
  let saved = 0;
  for (const [key, months] of combined) {
    await db.budget.deleteMany({ where: { lineKey: key, month: { in: sheetMonths } } });
    for (const [m, cents] of months) {
      await setBudget(db, m, key, cents);
      saved++;
    }
  }
  await db.budgetDraft.deleteMany({ where: { id: draftId } });
  return saved;
}
