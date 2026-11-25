import Link from "next/link";
import { ChevronRightIcon, HandCoinsIcon, PercentIcon, PlusIcon, TrendingUpIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { BarList, Donut, DueChart } from "@/components/register-charts";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { LOAN_KINDS, LOAN_STATUS_LABELS } from "@/lib/ledger/loan-kinds";
import { dueBuckets } from "@/lib/ledger/due-buckets";
import { type LoanSummary, formatRate, getLoans } from "@/lib/ledger/loans";
import { cn } from "@/lib/utils";

export const metadata = { title: "Lending & investments" };

export default async function LoansPage() {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const loans = await getLoans(db, today);
  const money = (v: bigint) => formatMoney(v, user.currency);
  const sum = (list: LoanSummary[], pick: (l: LoanSummary) => bigint) => list.reduce((s, l) => s + pick(l), BigInt(0));

  const active = loans.filter((l) => l.loan.status === "ACTIVE");
  const overdue = active.filter((l) => l.overdue);
  const dueSoon = active.filter((l) => l.dueSoon);
  const others = active.filter((l) => !l.overdue && !l.dueSoon);
  const closed = loans.filter((l) => l.loan.status !== "ACTIVE");

  const totalOut = sum(active, (l) => l.out);
  const interestAll = sum(loans, (l) => l.interest);
  const interestYear = sum(loans, (l) => l.interestThisYear);
  const lentAll = sum(loans, (l) => l.lent);
  const year = today.slice(0, 4);
  const overallReturn = lentAll > BigInt(0) ? Number((interestAll * BigInt(10_000)) / lentAll) / 100 : 0;
  const overdueOut = sum(overdue, (l) => l.out);

  // Charts: what's out, by type and by person, and when it's due back.
  const open = active.filter((l) => l.out > BigInt(0));
  const addTo = (m: Map<string, number>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0) + Number(v));
  const byKind = new Map<string, number>();
  const byPerson = new Map<string, number>();
  for (const l of open) {
    addTo(byKind, LOAN_KINDS[l.loan.kind as keyof typeof LOAN_KINDS]?.label ?? l.loan.kind, l.out);
    addTo(byPerson, l.loan.counterparty, l.out);
  }
  const slices = (m: Map<string, number>) => [...m].map(([label, value]) => ({ label, value }));
  const buckets = dueBuckets(
    open.filter((l) => l.loan.dueDate).map((l) => ({ date: l.loan.dueDate!, amount: l.out })),
    today,
  );

  const row = (l: LoanSummary) => (
    <Link key={l.loan.id} href={`/loans/${l.loan.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          l.overdue ? "bg-destructive/10 text-destructive" : "bg-tone-lent/12 text-tone-lent",
        )}
      >
        {l.overdue ? <TriangleAlertIcon className="size-4.5" /> : <HandCoinsIcon className="size-4.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{l.loan.counterparty}</span>
        <span className={cn("block truncate text-xs", l.overdue ? "text-destructive" : "text-muted-foreground")}>
          {LOAN_KINDS[l.loan.kind as keyof typeof LOAN_KINDS]?.label}
          {l.loan.rateBasisPoints > 0 && ` · ${formatRate(l.loan.rateBasisPoints, l.loan.ratePeriod)}`}
          {l.loan.status !== "ACTIVE"
            ? ` · ${LOAN_STATUS_LABELS[l.loan.status]}${l.loan.closedDate ? ` ${formatIsoDate(l.loan.closedDate)}` : ""}`
            : l.loan.dueDate
              ? ` · ${l.overdue ? "was due" : "due"} ${formatIsoDate(l.loan.dueDate)}`
              : ""}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-medium tabular-nums">{l.loan.status === "ACTIVE" ? money(l.out) : "—"}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">interest {money(l.interest)}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );

  const group = (title: string, list: LoanSummary[], tone?: "danger") =>
    list.length > 0 && (
      <section>
        <h2 className={cn("mb-1.5 px-1 text-sm font-medium", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
          {title} ({list.length})
        </h2>
        <div className={cn("divide-y overflow-hidden rounded-xl border bg-card", tone === "danger" && "border-destructive/40")}>{list.map(row)}</div>
      </section>
    );

  return (
    <>
      <WidePage />
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Lending & investments" description="Money you've lent or invested, what's due back, and what it has earned." />
        <Button className="h-10 gap-1.5" render={<Link href="/loans/new" />} nativeButton={false}>
          <PlusIcon /> Lend
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Out with people now" icon={HandCoinsIcon} tone="lent" value={money(totalOut)} sub={`${active.length} active`} />
        <StatTile label={`Interest earned · ${year}`} icon={TrendingUpIcon} tone="income" value={money(interestYear)} sub={`${money(interestAll)} all time`} />
        <StatTile label="Overall return" icon={PercentIcon} value={`${overallReturn.toFixed(2)}%`} sub="interest ÷ money lent" />
        <StatTile
          label="Overdue"
          icon={TriangleAlertIcon}
          tone="owe"
          value={money(overdueOut)}
          valueClassName={overdueOut > BigInt(0) ? "text-destructive" : undefined}
          sub={overdue.length ? `${overdue.length} past the due date` : "nothing overdue"}
        />
      </div>

      {open.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>By type</CardTitle>
              <CardDescription>What&apos;s out now</CardDescription>
            </CardHeader>
            <CardContent>
              <Donut slices={slices(byKind)} tone="lent" currency={user.currency} centerLabel="Out now" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By person</CardTitle>
              <CardDescription>Biggest first</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={slices(byPerson)} tone="lent" currency={user.currency} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2 2xl:col-span-1">
            <CardHeader>
              <CardTitle>Coming back</CardTitle>
              <CardDescription>Due each week for the next 8 weeks{overdueOut > BigInt(0) ? ", overdue in red" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              <DueChart buckets={buckets} tone="lent" currency={user.currency} />
            </CardContent>
          </Card>
        </div>
      )}

      {loans.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <HandCoinsIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing lent or invested yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Record cheque exchanges, personal loans and fixed deposits to track what&apos;s due back and the interest they earn.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {group("Overdue", overdue, "danger")}
          {group("Due in the next 30 days", dueSoon)}
          {group(overdue.length || dueSoon.length ? "Other active" : "Active", others)}
          {group("Repaid or written off", closed)}
        </div>
      )}
    </>
  );
}
