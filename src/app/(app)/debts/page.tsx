import Link from "next/link";
import { ChevronRightIcon, CreditCardIcon, LandmarkIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { DEBT_KINDS, DEBT_STATUS_LABELS, type DebtSummary, getDebts } from "@/lib/ledger/debts";
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

  const row = (d: DebtSummary) => {
    const Icon = d.overdue ? TriangleAlertIcon : d.isCard ? CreditCardIcon : LandmarkIcon;
    const sub = [
      DEBT_KINDS[d.debt.kind as keyof typeof DEBT_KINDS]?.label,
      d.isCard && d.debt.creditLimit ? `limit ${money(d.debt.creditLimit)}` : null,
      !d.isCard && d.debt.monthlyPayment ? `${money(d.debt.monthlyPayment)} / month` : null,
      d.debt.status !== "ACTIVE" ? DEBT_STATUS_LABELS[d.debt.status] : d.nextDue ? `${d.overdue ? "payment missed" : "due"} ${formatIsoDate(d.nextDue)}` : null,
    ].filter(Boolean);
    return (
      <Link key={d.debt.id} href={`/debts/${d.debt.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            d.overdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{d.debt.name}</span>
          <span className={cn("block truncate text-xs", d.overdue ? "text-destructive" : "text-muted-foreground")}>{sub.join(" · ")}</span>
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
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Credit cards & loans" description="What you owe, what's due, and what you've paid." />
        <Button className="h-10 gap-1.5" render={<Link href="/debts/new" />} nativeButton={false}>
          <PlusIcon /> Add
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">You owe</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(totalOwed)}</p>
          <p className="text-xs text-muted-foreground">{active.length} active</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Monthly instalments</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(monthly)}</p>
          <p className="text-xs text-muted-foreground">on loans</p>
        </div>
      </div>

      {debts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <CreditCardIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No cards or loans yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add your credit cards to pay for things with them, and your loans or pawning to track what you owe.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
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
