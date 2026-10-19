import type { UserDb } from "@/lib/db/scoped";
import { isMoneyAccount } from "./accounts";
import { ASSET_CLASSES } from "./asset-classes";
import { createAsset } from "./assets";
import { makePayment } from "./debts";
import { type EntryView, describeEntry } from "./describe";
import { type EntryInput, LedgerError, deleteEntry, saveEntry } from "./engine";
import { recordChange, snapshotEntry } from "./history";

/**
 * Bulk changes from the History workbench. Each change goes through the same
 * engine as the forms (so everything stays balanced and validated) and is
 * written to the edit history. Register movements (assets, lending, cards &
 * loans) are skipped: they're managed on their own pages.
 */

export type BulkOp =
  | { op: "category"; categoryId: string }
  | { op: "account"; accountId: string }
  | { op: "linkAsset"; assetId: string | null }
  | { op: "linkLoan"; loanId: string | null }
  | { op: "toAsset"; assetClass: string; lifeMonths: number }
  | { op: "toTransfer"; toAccountId: string }
  | { op: "toDebtPayment"; debtId: string }
  | { op: "delete" };

export type BulkResult = { changed: number; skipped: number; errors: string[] };

const LABEL: Record<BulkOp["op"], string> = {
  category: "Category changed in bulk",
  account: "Account changed in bulk",
  linkAsset: "Asset link changed in bulk",
  linkLoan: "Loan link changed in bulk",
  toAsset: "Converted to an asset in bulk",
  toTransfer: "Converted to a transfer in bulk",
  toDebtPayment: "Converted to a card / loan payment in bulk",
  delete: "Deleted in bulk",
};

/** The form input that recreates an entry as it is now. */
export function inputFromView(v: EntryView): EntryInput | null {
  const base = { date: v.date, amount: v.amount, details: v.details };
  switch (v.kind) {
    case "INCOME":
      return { kind: "INCOME", ...base, categoryId: v.categoryId!, accountId: v.accountId!, loanId: v.loanId ?? null };
    case "EXPENSE":
      return { kind: "EXPENSE", ...base, categoryId: v.categoryId!, accountId: v.accountId!, assetId: v.assetId ?? null };
    case "TRANSFER":
      return { kind: "TRANSFER", ...base, fromId: v.fromId!, toId: v.toId! };
    default:
      return null;
  }
}

/** Applies one change to an editable entry; returns the new input, or null if it doesn't apply to this kind. */
function changed(input: EntryInput, op: BulkOp): EntryInput | null {
  switch (op.op) {
    case "category":
      return input.kind === "INCOME" || input.kind === "EXPENSE" ? { ...input, categoryId: op.categoryId } : null;
    case "account":
      return input.kind === "INCOME" || input.kind === "EXPENSE" ? { ...input, accountId: op.accountId } : null;
    case "linkAsset":
      return input.kind === "EXPENSE" ? { ...input, assetId: op.assetId } : null;
    case "linkLoan":
      return input.kind === "INCOME" ? { ...input, loanId: op.loanId } : null;
    default:
      return null;
  }
}

export async function applyBulk(db: UserDb, entryIds: string[], op: BulkOp, today: string): Promise<BulkResult> {
  if (entryIds.length === 0) throw new LedgerError("Select at least one transaction.");
  if (entryIds.length > 5000) throw new LedgerError("Too many at once (max 5,000).");
  if (op.op === "toAsset") {
    if (!(op.assetClass in ASSET_CLASSES)) throw new LedgerError("Choose an asset class.");
    if (!Number.isInteger(op.lifeMonths) || op.lifeMonths < 0 || op.lifeMonths > 600) throw new LedgerError("Useful life must be between 0 and 50 years.");
  }

  const entries = await db.entry.findMany({
    where: { id: { in: entryIds } },
    include: { lines: { include: { account: true } } },
  });
  const result: BulkResult = { changed: 0, skipped: entryIds.length - entries.length, errors: [] };
  const change = { action: "BULK" as const, summary: LABEL[op.op] };

  for (const entry of entries) {
    const view = describeEntry(entry);
    const input = entry.debtId ? null : inputFromView(view);
    if (!input) {
      result.skipped++;
      continue;
    }
    try {
      switch (op.op) {
        case "delete":
          await deleteEntry(db, entry.id, change);
          break;
        case "toAsset": {
          if (input.kind !== "EXPENSE") throw new SkipError();
          const before = await snapshotEntry(db, entry.id);
          const assetId = await createAsset(
            db,
            {
              name: (view.details || view.categoryName || "Asset").slice(0, 80),
              assetClass: op.assetClass,
              purchaseDate: input.date,
              cost: input.amount,
              fundingAccountId: input.accountId,
              usefulLifeMonths: op.lifeMonths,
              residualValue: 0,
              details: view.details,
            },
            today,
            entry.id,
          );
          const purchase = await db.entry.findFirst({ where: { assetId, kind: "ASSET_PURCHASE" } });
          await recordChange(db, entry.id, "CONVERT", "Converted to an asset", before, null);
          if (purchase) await recordChange(db, purchase.id, "CONVERT", "Created from an expense", before, await snapshotEntry(db, purchase.id));
          break;
        }
        case "toTransfer": {
          if (input.kind !== "EXPENSE") throw new SkipError();
          const from = entry.lines.find((l) => l.accountId === input.accountId)?.account;
          if (!from || !isMoneyAccount(from)) throw new LedgerError("Only expenses paid from cash/bank can become transfers.");
          await saveEntry(db, { kind: "TRANSFER", date: input.date, amount: input.amount, details: input.details, fromId: input.accountId, toId: op.toAccountId }, entry.id, {
            change,
          });
          break;
        }
        case "toDebtPayment": {
          if (input.kind !== "EXPENSE") throw new SkipError();
          // Pay the card / loan first (it checks the amount owed), then remove the old expense.
          await makePayment(db, op.debtId, { date: input.date, principal: input.amount, interest: 0, fromAccountId: input.accountId, details: input.details }, today);
          const payment = await db.entry.findFirst({ where: { debtId: op.debtId, kind: "DEBT_PAYMENT" }, orderBy: { createdAt: "desc" } });
          await deleteEntry(db, entry.id, { action: "CONVERT", summary: "Converted to a card / loan payment" });
          if (payment) await recordChange(db, payment.id, "CONVERT", "Created from an expense", null, await snapshotEntry(db, payment.id));
          break;
        }
        default: {
          const next = changed(input, op);
          if (!next) throw new SkipError();
          await saveEntry(db, next, entry.id, { change });
        }
      }
      result.changed++;
    } catch (err) {
      if (err instanceof SkipError) result.skipped++;
      else if (err instanceof LedgerError) result.errors.push(`${view.date} ${view.details ?? view.categoryName ?? ""}: ${err.message}`.trim());
      else throw err;
    }
  }
  return result;
}

class SkipError extends Error {}
