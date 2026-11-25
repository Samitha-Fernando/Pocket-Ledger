import Link from "next/link";
import { CalendarClockIcon, ChevronRightIcon, CreditCardIcon, LandmarkIcon, PlusIcon, ScaleIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { Donut, DueChart, UsageBar } from "@/components/register-charts";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { DEBT_KINDS, DEBT_STATUS_LABELS, type DebtSummary, getDebts } from "@/lib/ledger/debts";
import { dueBuckets } from "@/lib/ledger/due-buckets";
import { cn } from "@/lib/utils";

export const metadata = { title: "Credit cards & loans" };

export default async function DebtsPage() {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const debts = await getDebts(db, today);
  const money = (v: bigint) => formatMoney(v, user.currency);

  const active = debts.filter((d) => d.debt.status === "ACTIVE");
  const overdue = active.filter((d) => d.overdue);
  const dueSoon = active.filter((d) => d.dueSoon);
  const cards = active.filter((d) => d.isCard && !d.overdue && !d.dueSoon);
  const loans = active.filter((d) => !d.isCard && !d.overdue && !d.dueSoon);
  const closed = debts.filter((d) => d.debt.status !== "ACTIVE");
  const totalOwed = active.reduce((s, d) => s + d.owed, BigInt(0));
  const monthly = active.reduce((s, d) => s + (d.debt.monthlyPayment ?? BigInt(0)), BigInt(0));

  // Cards: how much of the combined limit is used.
  const withLimit = active.filter((d) => d.isCard && d.debt.creditLimit);
  const cardOwed = withLimit.reduce((s, d) => s + d.owed, BigInt(0));
  const cardLimit = withLimit.reduce((s, d) => s + (d.debt.creditLimit ?? BigInt(0)), BigInt(0));
  const usedPct = cardLimit > BigInt(0) ? Number((cardOwed * BigInt(1000)) / cardLimit) / 10 : null;
  // Payments coming up: a loan's instalment, or what's owed on a card.
  const payments = active
    .filter((d) => d.nextDue && d.owed > BigInt(0))
    .map((d) => ({ date: d.nextDue!, amount: d.isCard ? d.owed : (d.debt.monthlyPayment ?? d.owed), name: d.debt.name }));
  const next = [...payments].sort((a, b) => a.date.localeCompare(b.date))[0];
  const owing = active.filter((d) => d.owed > BigInt(0));

  const row = (d: DebtSummary) => {
    const Icon = d.overdue ? TriangleAlertIcon : d.isCard ? CreditCardIcon : LandmarkIcon;
    const sub = [
      DEBT_KINDS[d.debt.kind as keyof typeof DEBT_KINDS]?.label,
      d.isCard && d.debt.creditLimit ? `limit ${money(d.debt.creditLimit)}` : null,
      !d.isCard && d.debt.monthlyPayment ? `${money(d.debt.monthlyPayment)} / month` : null,
      d.debt.status !== "ACTIVE" ? DEBT_STATUS_LABELS[d.debt.status] : d.nextDue ? `${d.overdue ? "payment missed" : "due"} ${formatIsoDate(d.nextDue)}` : null,
    ].filter(Boolean);
    return (
      <Link key={d.debt.id} href={`/debts/${d.debt.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            d.overdue ? "bg-destructive/10 text-destructive" : "bg-tone-owe/12 text-tone-owe",
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{d.debt.name}</span>
          <span className={cn("block truncate text-xs", d.overdue ? "text-destructive" : "text-muted-foreground")}>{sub.join(" · ")}</span>
          {d.isCard && d.debt.creditLimit && d.debt.status === "ACTIVE" && <UsageBar used={Number(d.owed)} limit={Number(d.debt.creditLimit)} className="mt-1.5 max-w-64" />}
        </span>
        <span className="text-right">
          <span className="block font-medium tabular-nums">{money(d.owed)}</span>
          {d.available !== null && <span className="block text-xs text-muted-foreground tabular-nums">{money(d.available)} left</span>}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  };

  const group = (title: string, list: DebtSummary[], tone?: "danger") =>
    list.length > 0 && (
      <section>
        <h2 className={cn("mb-1.5 px-1 text-sm font-medium", tone ? "text-destructive" : "text-muted-foreground")}>
          {title} ({list.length})
        </h2>
        <div className={cn("divide-y overflow-hidden rounded-xl border bg-card", tone && "border-destructive/40")}>{list.map(row)}</div>
      </section>
    );

  return (
    <>
      <WidePage />
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Credit cards & loans" description="What you owe, what's due, and what you've paid." />
        <Button className="h-10 gap-1.5" render={<Link href="/debts/new" />} nativeButton={false}>
          <PlusIcon /> Add
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="You owe" icon={ScaleIcon} tone="owe" value={money(totalOwed)} sub={`${active.length} active`} />
        <StatTile label="Monthly instalments" icon={LandmarkIcon} value={money(monthly)} sub="on loans" />
        <StatTile
          label="Credit used"
          icon={CreditCardIcon}
          tone="owe"
          value={usedPct === null ? "—" : `${usedPct.toFixed(0)}%`}
          valueClassName={usedPct !== null && usedPct >= 80 ? "text-destructive" : undefined}
          sub={usedPct === null ? "no card limits set" : `${money(cardOwed)} of ${money(cardLimit)}`}
        />
        <StatTile label="Next payment" icon={CalendarClockIcon} value={next ? formatIsoDate(next.date) : "—"} sub={next ? `${next.name} · ${money(next.amount)}` : "nothing due"} />
      </div>

      {owing.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>What you owe</CardTitle>
              <CardDescription>By card or loan</CardDescription>
            </CardHeader>
            <CardContent>
              <Donut slices={owing.map((d) => ({ label: d.debt.name, value: Number(d.owed) }))} tone="owe" currency={user.currency} centerLabel="You owe" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments coming up</CardTitle>
              <CardDescription>Each week for the next 8 weeks (loan instalments; full balance for cards)</CardDescription>
            </CardHeader>
            <CardContent>
              <DueChart buckets={dueBuckets(payments, today)} tone="owe" currency={user.currency} />
            </CardContent>
          </Card>
        </div>
      )}

      {debts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <CreditCardIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No cards or loans yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add your credit cards to pay for things with them, and your loans or pawning to track what you owe.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {group("Payment missed", overdue, "danger")}
          {group("Due in the next 7 days", dueSoon)}
          {group("Credit cards", cards)}
          {group("Loans", loans)}
          {group("Paid off", closed)}
        </div>
      )}
    </>
  );
}
