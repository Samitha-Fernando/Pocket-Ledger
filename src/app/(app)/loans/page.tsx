import Link from "next/link";
import { ChevronRightIcon, HandCoinsIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { LOAN_KINDS, LOAN_STATUS_LABELS } from "@/lib/ledger/loan-kinds";
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

  const row = (l: LoanSummary) => (
    <Link key={l.loan.id} href={`/loans/${l.loan.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          l.overdue ? "bg-destructive/10 text-destructive" : "bg-violet-500/10 text-violet-700 dark:text-violet-400",
        )}
      >
        {l.overdue ? <TriangleAlertIcon className="size-5" /> : <HandCoinsIcon className="size-5" />}
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
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Lending & investments" description="Money you've lent or invested, what's due back, and what it has earned." />
        <Button className="h-10 gap-1.5" render={<Link href="/loans/new" />} nativeButton={false}>
          <PlusIcon /> Lend
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="col-span-2 rounded-xl border bg-card p-4 lg:col-span-1">
          <p className="text-sm text-muted-foreground">Out with people now</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(totalOut)}</p>
          <p className="text-xs text-muted-foreground">{active.length} active</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Interest earned · {year}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(interestYear)}</p>
          <p className="text-xs text-muted-foreground">{money(interestAll)} all time</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Overall return</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{overallReturn.toFixed(2)}%</p>
          <p className="text-xs text-muted-foreground">interest ÷ money lent</p>
        </div>
      </div>

      {loans.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <HandCoinsIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing lent or invested yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Record cheque exchanges, personal loans and fixed deposits to track what&apos;s due back and the interest they earn.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          {group("Overdue", overdue, "danger")}
          {group("Due in the next 30 days", dueSoon)}
          {group(overdue.length || dueSoon.length ? "Other active" : "Active", others)}
          {group("Repaid or written off", closed)}
        </div>
      )}
    </>
  );
}
