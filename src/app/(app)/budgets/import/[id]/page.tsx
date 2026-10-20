import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatMonth } from "@/lib/format";
import { loadDraft, monthsAlreadyBudgeted } from "@/lib/import/budget-draft";
import { defaultBudgetTarget } from "@/lib/import/budget-sheet";
import { getBudgetLines } from "@/lib/ledger/budgets";
import { LedgerError } from "@/lib/ledger/engine";
import { BudgetPreviewForm, type PreviewLine } from "../forms";

export const metadata = { title: "Check budget import" };

export default async function BudgetPreviewPage({ params }: PageProps<"/budgets/import/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  let draft;
  try {
    draft = await loadDraft(db, id);
  } catch (err) {
    if (err instanceof LedgerError) notFound();
    throw err;
  }
  const [lines, accounts, replaces] = await Promise.all([getBudgetLines(db), db.account.findMany(), monthsAlreadyBudgeted(db, draft.lines)]);
  const optionsFor = (group: string) => lines.filter((l) => l.group === group).map((l) => ({ value: l.key, label: l.label }));

  const preview: PreviewLine[] = draft.lines.map((l) => {
    const months = Object.keys(l.values);
    return {
      group: l.group === "EXPENSE" ? "expenses" : l.group === "INCOME" ? "income" : "savings",
      label: l.label,
      months: months.length,
      total: Object.values(l.values).reduce((s, v) => s + v, 0),
      years: [...new Set(months.map((m) => m.slice(0, 4)))].sort().join(", "),
      target: defaultBudgetTarget(l, accounts) ?? "",
      options: optionsFor(l.group),
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/budgets/import" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Upload a different file
      </Link>
      <PageHeader title="Check before saving" description={`${draft.fileName} · ${preview.length} budget lines found. Choose where each goes.`} />
      {replaces.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {replaces.length} of these months already have budgets ({replaces.slice(0, 4).map(formatMonth).join(", ")}
          {replaces.length > 4 ? "…" : ""}). For the lines you import, those months will be replaced.
        </p>
      )}
      <Card>
        <CardContent>
          <BudgetPreviewForm draftId={id} lines={preview} currency={user.currency} replaces={replaces} />
        </CardContent>
      </Card>
    </div>
  );
}
