"use server";

import { revalidatePath } from "next/cache";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { todayIso } from "@/lib/format";
import { type BulkOp, applyBulk } from "@/lib/ledger/bulk";
import { LedgerError } from "@/lib/ledger/engine";
import { type RuleInput, applyRule, validateRule } from "@/lib/ledger/rules";

export type ActionResult = { error?: string; success?: string } | undefined;

/** Bulk change from the workbench (called directly from the browser). */
export async function bulkAction(entryIds: string[], op: BulkOp): Promise<ActionResult> {
  const { user, db } = await getLedger();
  try {
    const r = await applyBulk(db, entryIds, op, todayIso(user.timezone));
    await audit(user.id, "bulk_edit", `${op.op}: ${r.changed} changed`);
    revalidatePath("/", "layout");
    const parts = [`${r.changed} changed`];
    if (r.skipped) parts.push(`${r.skipped} skipped (this change doesn't apply to them)`);
    if (r.errors.length) {
      return { error: `${parts.join(", ")}. ${r.errors.length} couldn't be changed: ${r.errors.slice(0, 3).join("; ")}${r.errors.length > 3 ? "…" : ""}` };
    }
    return { success: `${parts.join(", ")}.` };
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
}

function readRule(fd: FormData): RuleInput {
  const appliesTo = field(fd, "appliesTo");
  return {
    contains: field(fd, "contains"),
    appliesTo: appliesTo === "EXPENSE" || appliesTo === "INCOME" ? appliesTo : "ANY",
    categoryId: field(fd, "categoryId") || null,
    assetId: field(fd, "assetId") || null,
    loanId: field(fd, "loanId") || null,
    accountId: field(fd, "accountId") || null,
  };
}

export async function createRuleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, db } = await getLedger();
  try {
    const input = await validateRule(db, readRule(fd));
    await db.rule.create({ data: input as never });
    await audit(user.id, "rule_created", input.contains);
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  revalidatePath("/history/rules");
  return { success: "Rule saved. Check how many past transactions it would change below." };
}

export async function applyRuleAction(fd: FormData) {
  const { user, db } = await getLedger();
  const r = await applyRule(db, field(fd, "ruleId"));
  await audit(user.id, "rule_applied", `${r.changed} changed`);
  revalidatePath("/", "layout");
}

export async function toggleRuleAction(fd: FormData) {
  const { db } = await getLedger();
  const id = field(fd, "ruleId");
  const rule = await db.rule.findUnique({ where: { id } });
  if (rule) await db.rule.update({ where: { id }, data: { active: !rule.active } });
  revalidatePath("/history/rules");
}

export async function deleteRuleAction(fd: FormData) {
  const { user, db } = await getLedger();
  await db.rule.deleteMany({ where: { id: field(fd, "ruleId") } });
  await audit(user.id, "rule_deleted");
  revalidatePath("/history/rules");
}
