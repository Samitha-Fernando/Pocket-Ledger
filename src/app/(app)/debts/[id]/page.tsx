import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, PencilIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { DEBT_KINDS, DEBT_STATUS_LABELS, getDebtDetails } from "@/lib/ledger/debts";
import { describeEntry } from "@/lib/ledger/describe";
import { getFormData } from "@/lib/ledger/form-data";
import { formatRate } from "@/lib/ledger/loans";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteDebtMovementAction } from "../actions";
import { BorrowForm, ChargeForm, DeleteDebtForm, PaymentForm } from "../forms";

export const metadata = { title: "Card or loan" };

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", tone === "bad" && "text-destructive")}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default async function DebtPage({ params }: PageProps<"/debts/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const today = todayIso(user.timezone);
  const d = await getDebtDetails(db, id, today);
  if (!d) notFound();
  const { debt } = d;
  const data = await getFormData(db, user.assetThresholdCents);
  const accounts = data.assets.filter((a) => !a.archived);
  const expenseCategories = data.expenseCategories.filter((c) => !c.archived);
  const money = (v: bigint | number) => formatMoney(v, user.currency);
  const kind = DEBT_KINDS[debt.kind as keyof typeof DEBT_KINDS];
  const entries = [...d.entries].reverse();
  // Suggest the usual instalment (capped at what's owed + this month's interest).
  const suggestedTotal =
    debt.monthlyPayment && d.owed > BigInt(0) ? Number(debt.monthlyPayment < d.owed + d.suggestedInterest ? debt.monthlyPayment : d.owed + d.suggestedInterest) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/debts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Credit cards & loans
      </Link>

      <div className="mb-5">
        <p className="text-sm text-muted-foreground">
          {kind?.label}
          {debt.lender && ` · ${debt.lender}`} · {DEBT_STATUS_LABELS[debt.status]}
          {debt.closedDate && ` on ${formatIsoDate(debt.closedDate)}`}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{debt.name}</h1>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{money(d.owed)}</p>
        <p className="text-xs text-muted-foreground">You owe</p>
      </div>

      {(d.overdue || d.dueSoon) && (
        <div
          className={cn(
            "mb-5 flex items-center gap-2 rounded-xl border p-3 text-sm",
            d.overdue ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          <TriangleAlertIcon className="size-4 shrink-0" />
          {d.overdue
            ? "A payment due date has passed with no payment recorded."
            : `Payment due on ${formatIsoDate(d.nextDue!)}.`}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {d.isCard ? (
          <>
            <Stat label="Credit limit" value={debt.creditLimit ? money(debt.creditLimit) : "Not set"} />
            <Stat label="Still available" value={d.available !== null ? money(d.available) : "—"} tone={d.available !== null && d.available < BigInt(0) ? "bad" : undefined} />
          </>
        ) : (
          <>
            <Stat label="Borrowed" value={money(d.borrowed)} note={`from ${formatIsoDate(debt.startDate)}`} />
            <Stat label="Monthly instalment" value={debt.monthlyPayment ? money(debt.monthlyPayment) : "Not set"} note={debt.endDate ? `until ${formatIsoDate(debt.endDate)}` : undefined} />
          </>
        )}
        <Stat label="Paid off so far" value={money(d.paid)} note={d.lastPayment ? `last paid ${formatIsoDate(d.lastPayment)}` : "no payments yet"} />
        <Stat label="Interest & fees paid" value={money(d.interestAndFees)} note={debt.rateBasisPoints ? formatRate(debt.rateBasisPoints, debt.ratePeriod) : undefined} />
        <Stat label="Next payment" value={d.nextDue ? formatIsoDate(d.nextDue) : debt.dueDay ? "Nothing owed" : "No due day set"} />
      </div>

      {debt.notes && <p className="mb-6 rounded-xl border bg-card p-3 text-sm">{debt.notes}</p>}

      <div className="mb-6 flex flex-wrap items-start gap-2">
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href={`/debts/${debt.id}/edit`} />} nativeButton={false}>
          <PencilIcon /> Edit details
        </Button>
        <DeleteDebtForm debtId={debt.id} />
      </div>

      <section className="mb-6">
        <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">
          {d.isCard ? "Purchases & payments" : "Borrowing & payments"} ({entries.length})
        </h2>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing yet. {d.isCard && "Choose this card under “Paid from” when you add an expense."}
          </p>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <EntryRow
                    entry={describeEntry(e)}
                    currency={user.currency}
                    trailing={<span className="block text-xs text-muted-foreground">{formatIsoDate(e.date)}</span>}
                  />
                </div>
                {e.debtId === debt.id ? (
                  <form action={deleteDebtMovementAction} className="pr-2">
                    <input type="hidden" name="entryId" value={e.id} />
                    <ConfirmButton message="Delete this movement? What you owe will be recalculated." size="icon" ariaLabel="Delete this movement">
                      <Trash2Icon />
                    </ConfirmButton>
                  </form>
                ) : (
                  <span className="w-11 shrink-0" title="A purchase: change it in History" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4">
        {d.owed > BigInt(0) && (
          <Card>
            <CardHeader>
              <CardTitle>Make a payment</CardTitle>
              <CardDescription>
                {d.isCard
                  ? "The whole payment comes off what you owe. Record statement interest separately below."
                  : `Interest for this month is suggested (${money(d.suggestedInterest)}); the rest comes off what you owe. You can change it.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentForm
                debtId={debt.id}
                today={today}
                currency={user.currency}
                owed={Number(d.owed)}
                suggestedInterest={Number(d.suggestedInterest)}
                suggestedTotal={suggestedTotal}
                accounts={accounts}
                expenseCategories={expenseCategories}
              />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Interest or fees charged</CardTitle>
            <CardDescription>From your statement: counted as an expense and added to what you owe.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChargeForm debtId={debt.id} today={today} expenseCategories={expenseCategories} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{d.isCard ? "Cash advance" : "Borrow more"}</CardTitle>
          </CardHeader>
          <CardContent>
            <BorrowForm debtId={debt.id} today={today} accounts={accounts} expenseCategories={expenseCategories} isCard={d.isCard} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
