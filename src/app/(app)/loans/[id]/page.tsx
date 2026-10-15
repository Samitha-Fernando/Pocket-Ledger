import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, PencilIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { describeEntry } from "@/lib/ledger/describe";
import { getFormData } from "@/lib/ledger/form-data";
import { LOAN_KINDS, LOAN_STATUS_LABELS } from "@/lib/ledger/loan-kinds";
import { formatRate, getLoanDetails } from "@/lib/ledger/loans";
import { cn } from "@/lib/utils";
import { deleteLoanAction, deleteMovementAction } from "../actions";
import { LendMoreForm, ReceiveBackForm, WriteOffForm } from "../forms";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata = { title: "Loan" };

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default async function LoanPage({ params }: PageProps<"/loans/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const today = todayIso(user.timezone);
  const d = await getLoanDetails(db, id, today);
  if (!d) notFound();
  const { loan } = d;
  const data = await getFormData(db, user.assetThresholdCents);
  const accounts = data.assets.filter((a) => !a.archived);
  const incomeCategories = data.incomeCategories.filter((c) => !c.archived);
  const money = (v: bigint | number) => formatMoney(v, user.currency);
  const active = loan.status === "ACTIVE";
  const kindLabel = LOAN_KINDS[loan.kind as keyof typeof LOAN_KINDS]?.label;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/loans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Lending & investments
      </Link>

      <div className="mb-5">
        <p className="text-sm text-muted-foreground">
          {kindLabel} · {LOAN_STATUS_LABELS[loan.status]}
          {loan.closedDate && ` on ${formatIsoDate(loan.closedDate)}`}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{loan.counterparty}</h1>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{money(d.out)}</p>
        <p className="text-xs text-muted-foreground">Still out</p>
      </div>

      {d.overdue && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" />
          Overdue: it was due back on {formatIsoDate(loan.dueDate!)}.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Lent" value={money(d.lent)} note={`from ${formatIsoDate(loan.startDate)}`} />
        <Stat label="Paid back" value={money(d.returned)} />
        <Stat label="Interest received" value={money(d.interest)} tone="good" note={`${d.returnPercent.toFixed(2)}% of money lent`} />
        <Stat
          label="Expected interest"
          value={d.expected === null ? "—" : money(d.expected)}
          note={loan.rateBasisPoints > 0 ? formatRate(loan.rateBasisPoints, loan.ratePeriod) : "No rate set"}
        />
        <Stat label="Due back" value={loan.dueDate ? formatIsoDate(loan.dueDate) : "Not set"} tone={d.overdue ? "bad" : undefined} />
        {d.writtenOff > BigInt(0) && <Stat label="Written off" value={money(d.writtenOff)} tone="bad" />}
      </div>

      {loan.notes && <p className="mb-6 rounded-xl border bg-card p-3 text-sm">{loan.notes}</p>}

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href={`/loans/${loan.id}/edit`} />} nativeButton={false}>
          <PencilIcon /> Edit details
        </Button>
        <form action={deleteLoanAction}>
          <input type="hidden" name="loanId" value={loan.id} />
          <ConfirmButton message="Delete this loan and every money movement recorded on it (including linked interest)? This can't be undone.">
            <Trash2Icon /> Delete loan
          </ConfirmButton>
        </form>
      </div>

      <section className="mb-6">
        <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Money movements ({d.entries.length})</h2>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {d.entries.map((e) => (
            <div key={e.id} className="flex items-center">
              <div className="min-w-0 flex-1">
                <EntryRow
                  entry={describeEntry(e)}
                  currency={user.currency}
                  trailing={<span className="block text-xs text-muted-foreground">{formatIsoDate(e.date)}</span>}
                />
              </div>
              {e.id === d.protectedEntryId ? (
                <span className="w-11 shrink-0" title="This is the original lending: use Delete loan instead" />
              ) : (
                <form action={deleteMovementAction} className="pr-2">
                  <input type="hidden" name="entryId" value={e.id} />
                  <ConfirmButton message="Delete this money movement? Balances will be recalculated." size="icon" ariaLabel="Delete this money movement">
                    <Trash2Icon />
                  </ConfirmButton>
                </form>
              )}
            </div>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">
          Interest paid separately can also be recorded with the normal Income form: choose this loan under &ldquo;From a loan or investment?&rdquo;.
        </p>
      </section>

      <div className="grid gap-4">
        {d.out > BigInt(0) && (
          <Card>
            <CardHeader>
              <CardTitle>Money received</CardTitle>
              <CardDescription>Enter the total you got. The app splits it: the loan first, anything extra is interest. You can change the split.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReceiveBackForm
                loanId={loan.id}
                today={today}
                currency={user.currency}
                outstanding={Number(d.out)}
                accounts={accounts}
                incomeCategories={incomeCategories}
                interestAccountId={loan.interestAccountId}
              />
            </CardContent>
          </Card>
        )}
        {loan.status !== "WRITTEN_OFF" && (
          <Card>
            <CardHeader>
              <CardTitle>Lend more</CardTitle>
            </CardHeader>
            <CardContent>
              <LendMoreForm loanId={loan.id} today={today} accounts={accounts} incomeCategories={incomeCategories} interestAccountId={loan.interestAccountId} />
            </CardContent>
          </Card>
        )}
        {active && d.out > BigInt(0) && (
          <Card>
            <CardHeader>
              <CardTitle>Not coming back?</CardTitle>
              <CardDescription>Write off what&apos;s still out as a &ldquo;Bad debts&rdquo; expense. Delete the write-off later if they do pay.</CardDescription>
            </CardHeader>
            <CardContent>
              <WriteOffForm loanId={loan.id} today={today} outstanding={money(d.out)} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
