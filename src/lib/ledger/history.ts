import type { Tx } from "./engine";

/**
 * Edit history: every change to a transaction is kept with a before → after
 * snapshot, so you can see what changed, when, and how (by hand, in bulk, by a
 * rule, by an import).
 */

export type ChangeAction = "CREATE" | "UPDATE" | "DELETE" | "BULK" | "RULE" | "IMPORT" | "UNDO" | "CONVERT";

export type Snapshot = {
  kind: string;
  date: string;
  details: string | null;
  assetId: string | null;
  loanId: string | null;
  lines: { account: string; amount: string }[]; // amount in cents, as text (no BigInt in JSON)
};

/** A transaction as plain JSON, readable without the rest of the database. */
export async function snapshotEntry(tx: Tx, entryId: string): Promise<Snapshot | null> {
  const e = await tx.entry.findUnique({ where: { id: entryId }, include: { lines: { include: { account: { select: { name: true } } } } } });
  if (!e) return null;
  return {
    kind: e.kind,
    date: e.date,
    details: e.details,
    assetId: e.assetId,
    loanId: e.loanId,
    lines: e.lines.map((l) => ({ account: l.account.name, amount: l.amount.toString() })),
  };
}

export async function recordChange(
  tx: Tx,
  entryId: string,
  action: ChangeAction,
  summary: string,
  before: Snapshot | null,
  after: Snapshot | null,
) {
  await tx.entryChange.create({
    data: {
      entryId,
      action,
      summary: summary.slice(0, 300),
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
    } as never,
  });
}

/** Plain-English list of what differs between two snapshots, e.g. "category Food → Groceries". */
export function describeDiff(before: Snapshot | null, after: Snapshot | null, formatCents: (c: bigint) => string) {
  if (!before || !after) return [];
  const out: string[] = [];
  if (before.kind !== after.kind) out.push(`type ${before.kind.toLowerCase()} → ${after.kind.toLowerCase()}`);
  if (before.date !== after.date) out.push(`date ${before.date} → ${after.date}`);
  if ((before.details ?? "") !== (after.details ?? "")) out.push(`details “${before.details ?? ""}” → “${after.details ?? ""}”`);
  const side = (s: Snapshot, sign: 1 | -1) =>
    s.lines
      .filter((l) => (sign > 0 ? BigInt(l.amount) > BigInt(0) : BigInt(l.amount) < BigInt(0)))
      .map((l) => l.account)
      .sort()
      .join(", ");
  if (side(before, 1) !== side(after, 1)) out.push(`to ${side(before, 1)} → ${side(after, 1)}`);
  if (side(before, -1) !== side(after, -1)) out.push(`from ${side(before, -1)} → ${side(after, -1)}`);
  const total = (s: Snapshot) => s.lines.filter((l) => BigInt(l.amount) > BigInt(0)).reduce((t, l) => t + BigInt(l.amount), BigInt(0));
  if (total(before) !== total(after)) out.push(`amount ${formatCents(total(before))} → ${formatCents(total(after))}`);
  if (before.assetId !== after.assetId) out.push(after.assetId ? "linked to an asset" : "unlinked from asset");
  if (before.loanId !== after.loanId) out.push(after.loanId ? "linked to a loan" : "unlinked from loan");
  return out;
}
