import Link from "next/link";
import { ArrowDownRightIcon, ArrowUpRightIcon, CalendarClockIcon, CreditCardIcon, HandCoinsIcon, InfoIcon } from "lucide-react";
import { IncomeExpenseChart, type MonthPoint, NetWorthChart, SavingsRateChart } from "@/components/dashboard-charts";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { getAccountsWithBalances } from "@/lib/ledger/accounts";
import {
  PERIODS,
  flows,
  getReportLines,
  getUpcoming,
  keptRate,
  monthlySeries,
  movedRate,
  netWorthAt,
  parsePeriod,
  previousPeriod,
  topCategories,
  trendMonths,
} from "@/lib/ledger/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Home" };

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ZERO = BigInt(0);

function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function pct(n: number | null) {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const params = await searchParams;
  const period = parsePeriod(params, today);
  const prev = previousPeriod(period);
  const lateDay = user.lateIncomeDay;
  const money = (v: bigint | number) => formatMoney(v, user.currency);

  const end = period.to < today ? period.to : today; // "as of" date for balances
  const [lines, accounts, upcoming] = await Promise.all([
    getReportLines(db, period.to > today ? period.to : today),
    getAccountsWithBalances(db),
    getUpcoming(db, today),
  ]);

  // ---- Numbers -------------------------------------------------------------
  const netWorthNow = netWorthAt(lines, today);
  const netWorthChange = netWorthAt(lines, end) - netWorthAt(lines, dayBefore(period.from));
  const f = flows(lines, period.from, period.to, lateDay);
  const kept = keptRate(f);
  const moved = movedRate(f);
  const months = trendMonths(period);
  const series = monthlySeries(lines, months, lateDay);
  const chartData: MonthPoint[] = series.map((s) => ({
    label: `${SHORT_MONTHS[Number(s.month.slice(5)) - 1]}${s.month.endsWith("-01") ? ` ${s.month.slice(2, 4)}` : ""}`,
    netWorth: Number(s.netWorth),
    income: Number(s.income),
    expenses: Number(s.expenses),
    kept: s.kept,
    moved: s.moved,
  }));
  const top = topCategories(lines, period, prev);

  const sum = (pick: (a: (typeof accounts)[number]) => boolean) => accounts.filter(pick).reduce((s, a) => s + a.balance, ZERO);
  const where = [
    { label: "Cash", value: sum((a) => a.type === "ASSET" && (a.subtype === "CASH" || a.subtype === "OTHER")), href: "/accounts" },
    { label: "Bank", value: sum((a) => a.type === "ASSET" && a.subtype === "BANK"), href: "/accounts" },
    { label: "Savings", value: sum((a) => a.type === "ASSET" && a.subtype === "SAVINGS"), href: "/accounts" },
    { label: "Lent out & invested", value: sum((a) => a.subtype === "LENT"), href: "/loans" },
    { label: "Fixed assets", value: sum((a) => a.subtype === "FIXED"), href: "/assets" },
  ];
  const owned = where.reduce((s, w) => s + (w.value > ZERO ? w.value : ZERO), ZERO);
  const debts = sum((a) => a.type === "LIABILITY");
  const share = (v: bigint) => (owned > ZERO && v > ZERO ? Number((v * BigInt(1000)) / owned) / 10 : 0);

  const periodLink = (key: string) => (key === "this-month" ? "/" : `/?period=${key}`);
  const historyLink = (extra: string) => `/history?from=${period.from}&to=${period.to}${extra}`;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} description={`Today is ${formatIsoDate(today)}`} />

      {/* Period selector */}
      <div className="mb-2 flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[])
          .filter((k) => k !== "custom")
          .map((k) => (
            <Link
              key={k}
              href={periodLink(k)}
              className={cn("flex h-9 items-center rounded-full border px-3 text-sm", period.key === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {PERIODS[k]}
            </Link>
          ))}
      </div>
      <details className="mb-5" open={period.key === "custom"}>
        <summary className="cursor-pointer text-sm text-muted-foreground select-none">
          {formatIsoDate(period.from)} – {formatIsoDate(period.to)} · choose dates
        </summary>
        <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <Input type="date" name="from" defaultValue={period.from} className="h-10 w-auto" aria-label="From" />
          <Input type="date" name="to" defaultValue={period.to} className="h-10 w-auto" aria-label="To" />
          <Button type="submit" variant="outline" className="h-10">
            Show
          </Button>
        </form>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Net worth */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription>Net worth (what you own − what you owe)</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{money(netWorthNow)}</CardTitle>
            <p className={cn("flex items-center gap-1 text-sm", netWorthChange >= ZERO ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
              {netWorthChange >= ZERO ? <ArrowUpRightIcon className="size-4" /> : <ArrowDownRightIcon className="size-4" />}
              {money(netWorthChange)} in {PERIODS[period.key].toLowerCase()}
            </p>
          </CardHeader>
          <CardContent>
            <NetWorthChart data={chartData} currency={user.currency} />
          </CardContent>
        </Card>

        {/* Where your money is */}
        <Card>
          <CardHeader>
            <CardTitle>Where your money is</CardTitle>
            <CardDescription>Today</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {where.map((w) => (
              <Link key={w.label} href={w.href} className="grid gap-1 rounded-lg px-1 py-0.5 hover:bg-muted/60">
                <span className="flex justify-between text-sm">
                  <span>{w.label}</span>
                  <span className="font-medium tabular-nums">{money(w.value)}</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${share(w.value)}%` }} />
                </span>
              </Link>
            ))}
            <Link href="/debts" className="flex justify-between rounded-lg border-t px-1 pt-3 text-sm hover:bg-muted/60">
              <span>Debts (cards & loans)</span>
              <span className="font-medium tabular-nums text-rose-700 dark:text-rose-400">−{money(debts)}</span>
            </Link>
          </CardContent>
        </Card>

        {/* Coming up */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClockIcon className="size-5 text-muted-foreground" /> Coming up
            </CardTitle>
            <CardDescription>Next 30 days, overdue first</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due back or to pay in the next 30 days.</p>
            ) : (
              <ul className="divide-y">
                {upcoming.map((u) => (
                  <li key={`${u.kind}-${u.id}`}>
                    <Link href={`/${u.kind === "loan" ? "loans" : "debts"}/${u.id}`} className="flex items-center gap-3 py-2 hover:bg-muted/60">
                      {u.kind === "loan" ? <HandCoinsIcon className="size-4 shrink-0 text-violet-600" /> : <CreditCardIcon className="size-4 shrink-0 text-amber-600" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{u.name}</span>
                        <span className={cn("block text-xs", u.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {u.note} · {formatIsoDate(u.date)}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">{money(u.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Income vs expenses */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Income vs expenses</CardTitle>
            <div className="grid grid-cols-3 gap-3 pt-2 text-sm">
              <Link href={historyLink("&type=income")} className="rounded-lg hover:bg-muted/60">
                <span className="block text-xs text-muted-foreground">Income</span>
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(f.income)}</span>
              </Link>
              <Link href={historyLink("&type=expense")} className="rounded-lg hover:bg-muted/60">
                <span className="block text-xs text-muted-foreground">Expenses</span>
                <span className="font-semibold tabular-nums">{money(f.expenses)}</span>
                {f.depreciation > ZERO && <span className="block text-xs text-muted-foreground">incl. {money(f.depreciation)} depreciation</span>}
              </Link>
              <div>
                <span className="block text-xs text-muted-foreground">Left over</span>
                <span className={cn("font-semibold tabular-nums", f.income - f.expenses < ZERO && "text-destructive")}>{money(f.income - f.expenses)}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={chartData} currency={user.currency} />
          </CardContent>
        </Card>

        {/* Savings rate */}
        <Card>
          <CardHeader>
            <CardTitle>Savings rate</CardTitle>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <span className="block text-xs text-muted-foreground">Kept (not spent)</span>
                <span className="text-2xl font-semibold tabular-nums">{pct(kept)}</span>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">Moved to savings</span>
                <span className="text-2xl font-semibold tabular-nums">{pct(moved)}</span>
                <span className="block text-xs text-muted-foreground">{money(f.movedToSavings)}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <SavingsRateChart data={chartData} />
            <p className="mt-2 text-xs text-muted-foreground">
              Kept = (income − expenses) ÷ income. Moved to savings = transfers into savings accounts ÷ income (like your spreadsheet).
            </p>
          </CardContent>
        </Card>

        {/* Top expense categories */}
        <Card>
          <CardHeader>
            <CardTitle>Top expenses</CardTitle>
            <CardDescription>Compared with the period before</CardDescription>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses in this period.</p>
            ) : (
              <ul className="grid gap-2.5">
                {top.map((t) => (
                  <li key={t.id}>
                    <Link href={historyLink(`&category=${t.id}`)} className="grid gap-1 rounded-lg px-1 py-0.5 hover:bg-muted/60">
                      <span className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">{t.name}</span>
                        <span className="shrink-0 font-medium tabular-nums">{money(t.amount)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-[var(--chart-expense)]" style={{ width: `${t.share}%` }} />
                        </span>
                        <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{t.share.toFixed(0)}%</span>
                        <span
                          className={cn(
                            "w-14 text-right text-xs tabular-nums",
                            t.change === null ? "text-muted-foreground" : t.change > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400",
                          )}
                        >
                          {t.change === null ? "new" : `${t.change > 0 ? "+" : ""}${t.change.toFixed(0)}%`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {lateDay && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5" /> Late income shift is on: income received on or after day {lateDay} counts toward the next month here (change in Settings).
        </p>
      )}
    </>
  );
}
