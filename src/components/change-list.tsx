import { HistoryIcon } from "lucide-react";
import type { EntryChange } from "@/generated/prisma/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { type Snapshot, describeDiff } from "@/lib/ledger/history";

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Added",
  UPDATE: "Edited",
  DELETE: "Deleted",
  BULK: "Bulk change",
  RULE: "Rule applied",
  IMPORT: "Imported",
  UNDO: "Import undone",
  CONVERT: "Converted",
};

/** The edit history of one transaction, newest first. */
export function ChangeList({ changes, currency }: { changes: EntryChange[]; currency: string }) {
  if (changes.length === 0) return null;
  const parse = (s: string | null) => (s ? (JSON.parse(s) as Snapshot) : null);
  return (
    <section className="mt-6">
      <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        <HistoryIcon className="size-4" /> Edit history
      </h2>
      <ol className="divide-y rounded-xl border bg-card text-sm">
        {changes.map((c) => {
          const diff = describeDiff(parse(c.before), parse(c.after), (cents) => formatMoney(cents, currency));
          return (
            <li key={c.id} className="px-3 py-2">
              <div className="flex justify-between gap-3">
                <span className="font-medium">{ACTION_LABELS[c.action] ?? c.action}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(c.createdAt)}</span>
              </div>
              {c.summary !== ACTION_LABELS[c.action] && <p className="text-xs text-muted-foreground">{c.summary}</p>}
              {diff.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {diff.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
