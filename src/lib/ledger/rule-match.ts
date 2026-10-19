/** Rule matching, as pure functions (safe to use in the browser for suggestions). */

type RuleLike = { contains: string; appliesTo: string; categoryId: string | null; assetId: string | null; loanId: string | null; accountId: string | null };

/** Does a rule match these details / this kind? Pure. */
export function ruleMatches(rule: RuleLike, details: string | null | undefined, kind: string) {
  if (!details || !rule.contains) return false;
  if (rule.appliesTo !== "ANY" && rule.appliesTo !== kind) return false;
  if (kind !== "EXPENSE" && kind !== "INCOME") return false;
  return details.toLowerCase().includes(rule.contains.toLowerCase());
}

/** What a rule would change on one entry; empty when nothing would change. Pure. */
export function ruleChanges(
  rule: RuleLike,
  e: { kind: string; categoryId?: string; accountId?: string; assetId?: string | null; loanId?: string | null },
) {
  const out: Record<string, string | null> = {};
  if (rule.categoryId && rule.categoryId !== e.categoryId) out.categoryId = rule.categoryId;
  if (rule.accountId && rule.accountId !== e.accountId) out.accountId = rule.accountId;
  if (e.kind === "EXPENSE" && rule.assetId && rule.assetId !== e.assetId) out.assetId = rule.assetId;
  if (e.kind === "INCOME" && rule.loanId && rule.loanId !== e.loanId) out.loanId = rule.loanId;
  return out;
}
