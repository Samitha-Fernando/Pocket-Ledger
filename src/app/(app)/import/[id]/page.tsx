import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon, ChevronLeftIcon, CircleAlertIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { centsToInput, formatMoney } from "@/lib/format";
import { batchSummary } from "@/lib/import/batch";
import { type Mapping, encodeTarget, mappingKey } from "@/lib/import/mapping";
import { getFormData } from "@/lib/ledger/form-data";
import { cn } from "@/lib/utils";
import { deleteBatchAction, undoAction } from "../actions";
import { MappingForm, type MappingKey, type Opt, PostForm, ReviewTable } from "../forms";

export const metadata = { title: "Import" };

const STEPS = [
  { key: "mapping", label: "1. Categories" },
  { key: "review", label: "2. Review rows" },
  { key: "post", label: "3. Post" },
] as const;

export default async function ImportBatchPage({ params, searchParams }: PageProps<"/import/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const { step: stepParam } = await searchParams;
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  const staged = batch.status === "STAGED";
  const step = (["mapping", "review", "post"] as const).find((s) => s === stepParam) ?? (staged ? "mapping" : "post");
  const money = (v: bigint | number) => formatMoney(v, user.currency);

  const [rows, data, debts, loans, summary] = await Promise.all([
    db.importRow.findMany({ where: { batchId: id }, orderBy: [{ date: "asc" }, { rowNumber: "asc" }], include: { entry: { select: { id: true } } } }),
    getFormData(db, user.assetThresholdCents),
    db.debt.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    db.loan.findMany({ select: { id: true, counterparty: true } }),
    batchSummary(db, id),
  ]);

  const opts = (list: { id: string; name: string; archived?: boolean }[], prefix: string): Opt[] =>
    list.filter((a) => !a.archived).map((a) => ({ value: `${prefix}${a.id}`, label: a.name }));
  const expense = opts(data.expenseCategories, "");
  const income = opts(data.incomeCategories, "");
  const savings = opts(data.assets.filter((a) => a.id !== batch.accountId), "");
  const debtOpts = debts.map((d) => ({ value: d.id, label: d.name }));

  const needDecision = rows.filter((r) => r.action === "REVIEW" && !r.entry).length;
  const toPost = rows.filter((r) => !r.entry && r.action !== "SKIP" && r.action !== "REVIEW").length;
  const postedCount = rows.filter((r) => r.entry).length;

  // Step 1: one choice per spreadsheet "Type / Category".
  const mapping = JSON.parse(batch.mapping) as Mapping;
  const keys: MappingKey[] = summary.map((g) => {
    const [type, ...rest] = g.key.split(" / ");
    const category = rest.join(" / ");
    const t = type.toLowerCase();
    const prefixed = (list: Opt[], action: string) => list.map((o) => ({ value: `${action}:${o.value}`, label: o.label }));
    const options: Opt[] = t.startsWith("income")
      ? [...prefixed(income, "INCOME"), { value: "NEW_INCOME", label: `New income category “${category}”` }]
      : t.startsWith("saving")
        ? [...prefixed(savings, "TRANSFER").map((o) => ({ ...o, label: `Transfer to ${o.label}` })), { value: "NEW_SAVINGS", label: `New savings account “${category}”` }]
        : [
            ...prefixed(expense, "EXPENSE"),
            ...expense
              .filter((o) => o.label === "Other")
              .map((o) => ({ value: `ASSET_RULE:${o.value}`, label: `Asset if ${money(user.assetThresholdCents)} or more, otherwise “Other”` })),
            ...debtOpts.map((d) => ({ value: `DEBT_PAYMENT:${d.value}`, label: `Payment on ${d.label}` })),
            { value: "NEW_EXPENSE", label: `New expense category “${category}”` },
          ];
    options.push({ value: "REVIEW", label: "Decide row by row" }, { value: "SKIP", label: "Don't import" });
    const current = mapping[mappingKey(type, category)];
    return { key: g.key, count: g.count, total: Number(g.total), value: current ? encodeTarget(current) : "REVIEW", options };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/import" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Imports
      </Link>
      <PageHeader title={batch.fileName} description={`${rows.length} rows · ${staged ? "not posted yet" : batch.status === "POSTED" ? "posted" : "undone"}`} />

      <nav className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" aria-label="Import steps">
        {STEPS.map((s) => (
          <Link
            key={s.key}
            href={`/import/${id}?step=${s.key}`}
            aria-current={step === s.key ? "step" : undefined}
            className="flex h-10 items-center justify-center rounded-lg text-sm font-medium text-muted-foreground aria-[current=step]:bg-background aria-[current=step]:text-foreground aria-[current=step]:shadow-sm"
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {step === "mapping" && (
        <Card>
          <CardHeader>
            <CardTitle>Where things go</CardTitle>
            <CardDescription>Check each spreadsheet category. Rows you change by hand on the next step keep your choice.</CardDescription>
          </CardHeader>
          <CardContent>
            <MappingForm
              batchId={id}
              accounts={data.assets.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))}
              accountId={batch.accountId}
              startingBalance={centsToInput(Number(batch.startingBalance ?? 0))}
              startingDate={batch.startingDate ?? ""}
              keys={keys}
              lateIncomeDay={batch.lateIncomeDay}
              currency={user.currency}
              readOnly={!staged}
            />
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <>
          {needDecision > 0 && staged && (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <CircleAlertIcon className="size-4 shrink-0" /> {needDecision} row{needDecision === 1 ? " needs" : "s need"} a decision before you can post.
            </p>
          )}
          <ReviewTable
            batchId={id}
            readOnly={!staged}
            currency={user.currency}
            options={{ EXPENSE: expense, INCOME: income, TRANSFER: savings, DEBT_PAYMENT: debtOpts, loans: loans.map((l) => ({ value: l.id, label: l.counterparty })) }}
            rows={rows.map((r) => ({
              id: r.id,
              rowNumber: r.rowNumber,
              date: r.date,
              type: r.type,
              category: r.category,
              amount: r.amount === null ? null : Number(r.amount),
              details: r.details,
              action: r.action,
              targetId: r.targetId,
              note: r.note,
              duplicate: r.duplicate,
              posted: Boolean(r.entry),
              assetName: r.assetName,
              assetClass: r.assetClass,
              lifeMonths: r.lifeMonths,
              loanId: r.loanId,
            }))}
          />
        </>
      )}

      {step === "post" && (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{staged ? "Ready to post?" : batch.status === "POSTED" ? "Posted" : "Undone"}</CardTitle>
              <CardDescription>
                {staged
                  ? `${toPost} row(s) will be posted${postedCount ? ` (${postedCount} already posted)` : ""}. ${needDecision ? `${needDecision} still need a decision.` : ""}`
                  : batch.status === "POSTED"
                    ? `${postedCount} transactions were created from this file.`
                    : "Everything this import created has been removed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">Spreadsheet category</th>
                      <th className="px-3 py-2 text-right font-medium">Rows</th>
                      <th className="px-3 py-2 text-right font-medium">In spreadsheet</th>
                      <th className="px-3 py-2 text-right font-medium">{staged ? "To post" : "Posted"}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((g) => {
                      const shown = staged ? g.toPost : g.posted;
                      const matches = shown === g.total;
                      return (
                        <tr key={g.key} className="border-b last:border-0">
                          <td className="px-3 py-1.5">{g.key}</td>
                          <td className="px-3 py-1.5 text-right">{g.count}</td>
                          <td className="px-3 py-1.5 text-right">{money(g.total)}</td>
                          <td className="px-3 py-1.5 text-right">{money(shown)}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {matches ? (
                              <CheckCircle2Icon className="size-4 text-emerald-600" aria-label="Matches" />
                            ) : (
                              <span className={cn("text-muted-foreground", g.review > 0 && "text-amber-700 dark:text-amber-400")}>
                                {[g.skipped && `${g.skipped} skipped`, g.review && `${g.review} undecided`].filter(Boolean).join(", ")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {batch.startingBalance && batch.startingBalance !== BigInt(0) ? (
                <p className="text-sm text-muted-foreground">Plus a starting balance of {money(batch.startingBalance)}.</p>
              ) : null}
              {staged && <PostForm batchId={id} disabled={needDecision > 0 || toPost === 0} />}
              {!staged && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="h-10" render={<Link href="/history" />} nativeButton={false}>
                    See History
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {(batch.status === "POSTED" || postedCount > 0) && batch.status !== "UNDONE" && (
              <form action={undoAction}>
                <input type="hidden" name="batchId" value={id} />
                <ConfirmButton message="Undo this import? Every transaction (and asset) it created will be removed.">
                  <UndoIcon /> Undo this whole import
                </ConfirmButton>
              </form>
            )}
            {(staged && postedCount === 0) || batch.status === "UNDONE" ? (
              <form action={deleteBatchAction}>
                <input type="hidden" name="batchId" value={id} />
                <ConfirmButton message="Delete this import and its staged rows?">
                  <Trash2Icon /> Delete this import
                </ConfirmButton>
              </form>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
