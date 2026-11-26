import type { Rule } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { canPayFrom, isMoneyAccount } from "./accounts";
import { describeEntry } from "./describe";
import { LedgerError, saveEntry } from "./engine";
import { inputFromView } from "./bulk";
import { ruleChanges, ruleMatches } from "./rule-match";

export { ruleChanges, ruleMatches } from "./rule-match";

/**
 * Rules: "if the details contain X → set category / link asset / link loan /
 * set account". Applied to past transactions on request (with a preview), and
 * suggested (never applied silently) when adding new ones.
 */

export type RuleInput = {
  contains: string;
  appliesTo: "ANY" | "EXPENSE" | "INCOME";
  categoryId?: string | null;
  assetId?: string | null;
  loanId?: string | null;
  accountId?: string | null;
};

export type RuleLike = Pick<Rule, "contains" | "appliesTo" | "categoryId" | "assetId" | "loanId" | "accountId">;

export async function validateRule(db: UserDb, input: RuleInput): Promise<RuleInput> {
  const contains = input.contains.trim();
  if (!contains) throw new LedgerError("Enter the text to look for in the details.");
  if (contains.length > 100) throw new LedgerError("That text is too long (max 100 characters).");
  if (!input.categoryId && !input.assetId && !input.loanId && !input.accountId) {
    throw new LedgerError("Choose at least one thing for the rule to do.");
  }
  let appliesTo = input.appliesTo;
  if (input.categoryId) {
    const c = await db.account.findUnique({ where: { id: input.categoryId } });
    if (!c || (c.type !== "EXPENSE" && c.type !== "INCOME") || c.isSystem) throw new LedgerError("Choose a valid category.");
    appliesTo = c.type; // an expense category only makes sense on expenses
  }
  if (input.assetId) {
    if (!(await db.fixedAsset.findUnique({ where: { id: input.assetId } }))) throw new LedgerError("Choose a valid asset.");
    if (appliesTo === "INCOME") throw new LedgerError("Assets can only be linked to expenses.");
    appliesTo = "EXPENSE";
  }
  if (input.loanId) {
    if (!(await db.loan.findUnique({ where: { id: input.loanId } }))) throw new LedgerError("Choose a valid loan.");
    if (appliesTo === "EXPENSE") throw new LedgerError("Loans can only be linked to income.");
    appliesTo = "INCOME";
  }
  if (input.accountId) {
    const a = await db.account.findUnique({ where: { id: input.accountId } });
    if (!a || a.isSystem || !(appliesTo === "INCOME" ? isMoneyAccount(a) : canPayFrom(a))) throw new LedgerError("Choose a valid account.");
    if (a.currency) throw new LedgerError("Rules can only set an account in your own currency.");
  }
  return { contains, appliesTo, categoryId: input.categoryId || null, assetId: input.assetId || null, loanId: input.loanId || null, accountId: input.accountId || null };
}

async function candidates(db: UserDb, rule: RuleLike) {
  const entries = await db.entry.findMany({
    where: {
      kind: rule.appliesTo === "ANY" ? { in: ["EXPENSE", "INCOME"] } : (rule.appliesTo as "EXPENSE"),
      debtId: null,
      details: { contains: rule.contains },
    },
    include: { lines: { include: { account: true } } },
    orderBy: { date: "desc" },
  });
  return entries
    .map((e) => describeEntry(e))
    .filter((v) => ruleMatches(rule, v.details, v.kind) && Object.keys(ruleChanges(rule, v)).length > 0);
}

/** Past transactions the rule would change (for the preview). */
export async function previewRule(db: UserDb, rule: RuleLike) {
  return candidates(db, rule);
}

/** Applies a rule to every matching past transaction. */
export async function applyRule(db: UserDb, ruleId: string) {
  const rule = await db.rule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new LedgerError("That rule no longer exists.");
  const result = { changed: 0, errors: [] as string[] };
  for (const view of await candidates(db, rule)) {
    const input = inputFromView(view);
    if (!input || (input.kind !== "EXPENSE" && input.kind !== "INCOME")) continue;
    const next = { ...input, ...ruleChanges(rule, view) } as typeof input;
    try {
      await saveEntry(db, next, view.id, { change: { action: "RULE", summary: `Rule “${rule.contains}” applied` } });
      result.changed++;
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      result.errors.push(`${view.date} ${view.details ?? ""}: ${err.message}`);
    }
  }
  return result;
}
