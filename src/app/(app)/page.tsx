import Link from "next/link";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  CreditCardIcon,
  HandCoinsIcon,
  InfoIcon,
  LandmarkIcon,
  PiggyBankIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import { IncomeExpenseChart, type MonthPoint, NetWorthChart, SavingsRateChart } from "@/components/dashboard-charts";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { StatTile, TONES, type Tone } from "@/components/stat-tile";
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
import { actuals, compare, getBudgetLines, getBudgets, monthsBetween, totals } from "@/lib/ledger/budgets";

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
  const [lines, accounts, upcoming, rates] = await Promise.all([
    getReportLines(db, period.to > today ? period.to : today),
    getAccountsWithBalances(db),
    getUpcoming(db, today),
    // Money in another currency (e.g. USD) is valued at the rate on each date.
    db.exchangeRate.findMany({ select: { currency: true, date: true, rate4: true } }),
  ]);

  // ---- Numbers -------------------------------------------------------------
  const netWorthNow = netWorthAt(lines, today, rates);
  const netWorthChange = netWorthAt(lines, end, rates) - netWorthAt(lines, dayBefore(period.from), rates);
  const f = flows(lines, period.from, period.to, lateDay);
  const kept = keptRate(f);
  const moved = movedRate(f);
  const months = trendMonths(period);
  const series = monthlySeries(lines, months, lateDay, rates);
  const chartData: MonthPoint[] = series.map((s) => ({
    label: `${SHORT_MONTHS[Number(s.month.slice(5)) - 1]}${s.month.endsWith("-01") ? ` ${s.month.slice(2, 4)}` : ""}`,
    netWorth: Number(s.netWorth),
    income: Number(s.income),
    expenses: Number(s.expenses),
    kept: s.kept,
    moved: s.moved,
  }));
  const top = topCategories(lines, period, prev);

  // Budget vs actual for the period (spending lines).
  const budgetMonths = monthsBetween(period.from, period.to);
  const budgetRows = compare(await getBudgetLines(db), await getBudgets(db, budgetMonths), budgetMonths, actuals(lines, period.from, period.to, lateDay));
  const budgetTotals = totals(budgetRows);
  const overBudget = budgetRows.filter((r) => r.group === "EXPENSE" && r.status === "over").sort((a, b) => Number(a.remaining - b.remaining)).slice(0, 3);
  const spendPct = budgetTotals.expense.budget > ZERO ? Number((budgetTotals.expense.actual * BigInt(1000)) / budgetTotals.expense.budget) / 10 : null;

  const sum = (pick: (a: (typeof accounts)[number]) => boolean) => accounts.filter(pick).reduce((s, a) => s + a.valueNow, ZERO);
  const where: { label: string; value: bigint; href: string; tone: Tone }[] = [
    { label: "Cash", value: sum((a) => a.type === "ASSET" && (a.subtype === "CASH" || a.subtype === "OTHER")), href: "/accounts", tone: "money" },
    { label: "Bank", value: sum((a) => a.type === "ASSET" && a.subtype === "BANK"), href: "/accounts", tone: "money" },
    { label: "Savings", value: sum((a) => a.type === "ASSET" && a.subtype === "SAVINGS"), href: "/accounts", tone: "savings" },
    { label: "Lent out & invested", value: sum((a) => a.subtype === "LENT"), href: "/loans", tone: "lent" },
    { label: "Fixed assets", value: sum((a) => a.subtype === "FIXED"), href: "/assets", tone: "assets" },
  ];
  const owned = where.reduce((s, w) => s + (w.value > ZERO ? w.value : ZERO), ZERO);
  const debts = sum((a) => a.type === "LIABILITY");
  const share = (v: bigint) => (owned > ZERO && v > ZERO ? Number((v * BigInt(1000)) / owned) / 10 : 0);

  const periodLink = (key: string) => (key === "this-month" ? "/" : `/?period=${key}`);
  const historyLink = (extra: string) => `/history?from=${period.from}&to=${period.to}${extra}`;

  return (
    <>
      <WidePage />
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

      {/* Headline numbers for the period */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Net worth"
          icon={LandmarkIcon}
          value={money(netWorthNow)}
          sub={
            <span className={cn("inline-flex items-center gap-0.5", netWorthChange >= ZERO ? TONES.income.text : TONES.owe.text)}>
              {netWorthChange >= ZERO ? <ArrowUpRightIcon className="size-3.5" /> : <ArrowDownRightIcon className="size-3.5" />}
              {money(netWorthChange)} in {PERIODS[period.key].toLowerCase()}
            </span>
          }
        />
        <StatTile label="Income" icon={TrendingUpIcon} tone="income" value={money(f.income)} href={historyLink("&type=income")} sub={PERIODS[period.key]} />
        <StatTile
          label="Expenses"
          icon={TrendingDownIcon}
          tone="expense"
          value={money(f.expenses)}
          href={historyLink("&type=expense")}
          sub={f.depreciation > ZERO ? `incl. ${money(f.depreciation)} depreciation` : PERIODS[period.key]}
        />
        <StatTile
          label="Kept (not spent)"
          icon={PiggyBankIcon}
          tone="savings"
          value={pct(kept)}
          valueClassName={kept !== null && kept < 0 ? "text-destructive" : undefined}
          sub={`${money(f.movedToSavings)} moved to savings (${pct(moved)})`}
        />
      </div>

      {/* Cards: 1 column on phones, 2 on laptops, 3 on big screens; "dense" fills gaps. */}
      <div className="grid gap-4 lg:grid-flow-row-dense lg:grid-cols-2 2xl:grid-cols-3">
        {/* Net worth */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Net worth over time</CardTitle>
            <CardDescription>What you own − what you owe, at the end of each month</CardDescription>
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
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", TONES[w.tone].bar)} />
                    {w.label}
                  </span>
                  <span className="font-medium tabular-nums">{money(w.value)}</span>
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", TONES[w.tone].bar)} style={{ width: `${share(w.value)}%` }} />
                </span>
              </Link>
            ))}
            <Link href="/debts" className="flex justify-between rounded-lg border-t px-1 pt-3 text-sm hover:bg-muted/60">
              <span className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", TONES.owe.bar)} />
                Debts (cards & loans)
              </span>
              <span className={cn("font-medium tabular-nums", TONES.owe.text)}>−{money(debts)}</span>
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
                      {u.kind === "loan" ? <HandCoinsIcon className="size-4 shrink-0 text-tone-lent" /> : <CreditCardIcon className="size-4 shrink-0 text-tone-owe" />}
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
            <CardDescription>
              Each month · left over in {PERIODS[period.key].toLowerCase()}:{" "}
              <span className={cn("font-medium tabular-nums", f.income - f.expenses < ZERO ? "text-destructive" : "text-foreground")}>{money(f.income - f.expenses)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={chartData} currency={user.currency} />
          </CardContent>
        </Card>

        {/* Savings rate */}
        <Card>
          <CardHeader>
            <CardTitle>Savings rate</CardTitle>
            <CardDescription>
              Kept <span className="font-medium text-foreground tabular-nums">{pct(kept)}</span> · moved to savings{" "}
              <span className="font-medium text-foreground tabular-nums">{pct(moved)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SavingsRateChart data={chartData} />
            <p className="mt-2 text-xs text-muted-foreground">
              Kept = (income − expenses) ÷ income. Moved to savings = transfers into savings accounts ÷ income (like your spreadsheet).
            </p>
          </CardContent>
        </Card>

        {/* Budget vs actual */}
        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
            <CardDescription>Spending vs plan for this period</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {spendPct === null ? (
              <p className="text-sm text-muted-foreground">
                No budget for this period yet.{" "}
                <Link href="/budgets" className="text-primary underline-offset-4 hover:underline">
                  Plan one
                </Link>{" "}
                or import your Budget Planning sheet.
              </p>
            ) : (
              <>
                <div className="flex items-baseline justify-between text-sm">
                  <span>
                    <span className="text-lg font-semibold tabular-nums">{money(budgetTotals.expense.actual)}</span>
                    <span className="text-muted-foreground"> of {money(budgetTotals.expense.budget)}</span>
                  </span>
                  <span className={cn("tabular-nums", spendPct > 100 ? "font-medium text-destructive" : "text-muted-foreground")}>{spendPct.toFixed(0)}%</span>
                </div>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", spendPct > 100 ? "bg-destructive" : spendPct >= 90 ? "bg-tone-assets" : "bg-tone-income")}
                    style={{ width: `${Math.min(100, spendPct)}%` }}
                  />
                </span>
                {overBudget.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {overBudget.map((r) => (
                      <li key={r.key} className="flex justify-between gap-2">
                        <span className="truncate">{r.label}</span>
                        <span className="shrink-0 text-destructive tabular-nums">{money(-r.remaining)} over</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-tone-income">Every line is within budget.</p>
                )}
                <Link href={`/budgets?view=actual&year=${period.to.slice(0, 4)}&month=${period.key === "this-month" || period.key === "last-month" ? period.from.slice(0, 7) : "year"}`} className="text-sm text-primary underline-offset-4 hover:underline">
                  See every line
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* Top expense categories */}
        <Card className="lg:col-span-2 2xl:col-span-1">
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
                            t.change === null ? "text-muted-foreground" : t.change > 0 ? "text-tone-owe" : "text-tone-income",
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
