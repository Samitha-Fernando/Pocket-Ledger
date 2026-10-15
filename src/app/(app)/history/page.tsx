import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, ReceiptTextIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMonth, formatMoney, shiftMonth, todayIso } from "@/lib/format";
import { describeEntry } from "@/lib/ledger/describe";

export const metadata = { title: "History" };

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const { user, db } = await getLedger();
  const { month: monthParam } = await searchParams;
  const thisMonth = todayIso(user.timezone).slice(0, 7);
  const month = typeof monthParam === "string" && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : thisMonth;

  const entries = (
    await db.entry.findMany({
      where: { date: { gte: `${month}-01`, lte: `${month}-31` } },
      include: { lines: { include: { account: true } }, asset: { select: { name: true } }, loan: { select: { counterparty: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    })
  ).map(describeEntry);

  // Income includes interest earned on loans (kept up front or received with the money back).
  const income = entries.reduce((s, e) => s + (e.kind === "INCOME" ? e.amount : (e.interestAmount ?? 0)), 0);
  // Depreciation and written-off loans are real (non-cash) expenses, so they count too.
  const expenses = entries
    .filter((e) => e.kind === "EXPENSE" || e.kind === "DEPRECIATION" || e.kind === "LOAN_WRITE_OFF")
    .reduce((s, e) => s + e.amount, 0);

  // Group by day, newest first.
  const days = new Map<string, typeof entries>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return (
    <>
      <PageHeader title="History" />

      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="outline" size="icon-lg" aria-label="Previous month" render={<Link href={`/history?month=${shiftMonth(month, -1)}`} />} nativeButton={false}>
          <ChevronLeftIcon />
        </Button>
        <p className="font-medium">{formatMonth(month)}</p>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Next month"
          disabled={month >= thisMonth}
          render={<Link href={`/history?month=${shiftMonth(month, 1)}`} />}
          nativeButton={false}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Income</p>
          <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(income, user.currency)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Expenses</p>
          <p className="font-semibold tabular-nums">{formatMoney(expenses, user.currency)}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <ReceiptTextIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing recorded in {formatMonth(month)}</p>
          <Link href="/add" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
            Add a transaction
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...days].map(([date, list]) => (
            <section key={date}>
              <h2 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{formatIsoDate(date)}</h2>
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {list.map((e) => (
                  <EntryRow key={e.id} entry={e} currency={user.currency} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
