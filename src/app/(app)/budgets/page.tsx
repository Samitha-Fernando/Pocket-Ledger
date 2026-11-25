import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, FileSpreadsheetIcon, PiggyBankIcon, ScaleIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { StatTile, TONES } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatMonth, formatMoney, todayIso } from "@/lib/format";
import { type BudgetRow, actuals, compare, getBudgetLines, getBudgets, monthEnd, monthsOfYear, totals } from "@/lib/ledger/budgets";
import { getReportLines } from "@/lib/ledger/reports";
import { cn } from "@/lib/utils";
import { CopyYearButton } from "./copy-year";
import { BudgetGrid } from "./grid";

export const metadata = { title: "Budgets" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const params = await searchParams;
  const thisYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(one(params.year)) ? Number(one(params.year)) : thisYear;
  const view = one(params.view) === "actual" ? "actual" : "plan";
  const months = monthsOfYear(year);
  const month = months.includes(one(params.month)) ? one(params.month) : months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months[0];
  const whole = one(params.month) === "year";
  const money = (v: bigint | number) => formatMoney(v, user.currency);

  const [lines, budgets] = await Promise.all([getBudgetLines(db), getBudgets(db, months)]);
  const link = (p: Record<string, string | number>) => `/budgets?${new URLSearchParams({ year: String(year), view, ...(view === "actual" ? { month: whole ? "year" : month } : {}), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;

  // Budget vs actual for the chosen month (or the whole year).
  let rows: BudgetRow[] = [];
  if (view === "actual") {
    const range = whole ? months : [month];
    const from = `${range[0]}-01`;
    const to = monthEnd(range[range.length - 1]);
    const reportLines = await getReportLines(db, to);
    rows = compare(lines, budgets, range, actuals(reportLines, from, to, user.lateIncomeDay));
  }
  const t = totals(rows);
  const spentPct = t.expense.budget > BigInt(0) ? Number((t.expense.actual * BigInt(1000)) / t.expense.budget) / 10 : 0;
  const pace = !whole && month === today.slice(0, 7) ? (Number(today.slice(8, 10)) / Number(monthEnd(month).slice(8, 10))) * 100 : null;
  const hasAny = budgets.size > 0;

  return (
    <>
      <WidePage />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Budgets" description="Plan each month like your spreadsheet, then see how you're doing." />
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/budgets/import" />} nativeButton={false}>
          <FileSpreadsheetIcon /> Import from Excel
        </Button>
      </div>
      {one(params.imported) && <p className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">Budgets imported.</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-lg" aria-label="Previous year" render={<Link href={link({ year: year - 1, month: "" })} />} nativeButton={false}>
            <ChevronLeftIcon />
          </Button>
          <span className="w-14 text-center font-semibold">{year}</span>
          <Button variant="outline" size="icon-lg" aria-label="Next year" render={<Link href={link({ year: year + 1, month: "" })} />} nativeButton={false}>
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(["plan", "actual"] as const).map((v) => (
            <Link
              key={v}
              href={`/budgets?year=${year}&view=${v}`}
              aria-current={view === v ? "page" : undefined}
              className="flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
            >
              {v === "plan" ? "Plan" : "Budget vs actual"}
            </Link>
          ))}
        </div>
        {view === "plan" && <CopyYearButton year={year} />}
      </div>

      {view === "plan" ? (
        <>
          {!hasAny && (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
              <CopyIcon className="size-4 shrink-0" /> No budget for {year} yet. Type amounts below, import your Budget Planning sheet, or copy last year.
            </p>
          )}
          <BudgetGrid
            year={year}
            lines={lines}
            currency={user.currency}
            currentMonth={today.slice(0, 7)}
            initial={Object.fromEntries([...budgets].map(([k, m]) => [k, Object.fromEntries([...m].map(([mm, v]) => [mm, Number(v)]))]))}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Amounts save when you leave a cell. ↻ next to a line = same amount every month; the copy icon on a month copies the month before into it.
          </p>
        </>
      ) : (
        <>
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {[...months, "year"].map((m) => {
              const active = m === "year" ? whole : !whole && m === month;
              return (
                <Link
                  key={m}
                  href={link({ month: m })}
                  className={cn("flex h-9 shrink-0 items-center rounded-full border px-3 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {m === "year" ? "Whole year" : formatMonth(m).slice(0, 3)}
                </Link>
              );
            })}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Income" icon={TrendingUpIcon} tone="income" value={money(t.income.actual)} sub={`of ${money(t.income.budget)} planned`} />
            <StatTile label="Spending" icon={TrendingDownIcon} tone="expense" value={money(t.expense.actual)} sub={`of ${money(t.expense.budget)} planned`} />
            <StatTile label="Saved" icon={PiggyBankIcon} tone="savings" value={money(t.savings.actual)} sub={`of ${money(t.savings.budget)} planned`} />
            <StatTile
              label="Left over"
              icon={ScaleIcon}
              value={money(t.leftActual)}
              valueClassName={t.leftActual < BigInt(0) ? "text-destructive" : undefined}
              sub={`income − spending − saved · plan ${money(t.toBeAllocated)}`}
            />
          </div>

          {t.expense.budget > BigInt(0) && (
            <div className="mb-5 rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">Spending vs plan</span>
                <span className="tabular-nums">
                  <span className={cn("font-semibold", spentPct > 100 && "text-destructive")}>{spentPct.toFixed(0)}%</span>
                  <span className="text-muted-foreground"> used{pace !== null ? ` · ${pace.toFixed(0)}% of the month gone` : ""}</span>
                </span>
              </div>
              <div className="relative mt-2.5 h-3 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", spentPct > 100 ? "bg-destructive" : pace !== null && spentPct > pace + 10 ? "bg-tone-assets" : "bg-tone-income")}
                  style={{ width: `${Math.min(100, spentPct)}%` }}
                />
                {pace !== null && <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${pace}%` }} title="Where spending would be at an even pace" />}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {spentPct > 100
                  ? `Over the plan by ${money(t.expense.actual - t.expense.budget)}.`
                  : pace !== null
                    ? spentPct > pace + 10
                      ? "Spending faster than an even pace through the month."
                      : "On track: spending is at or below an even pace."
                    : `${money(t.expense.budget - t.expense.actual)} of the plan left.`}
              </p>
            </div>
          )}

          <div className="mb-5 grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-3">
          {(["EXPENSE", "INCOME", "SAVINGS"] as const).map((group) => {
            const list = rows.filter((r) => r.group === group && (r.budget > BigInt(0) || r.actual !== BigInt(0)));
            if (list.length === 0) return null;
            const tone = TONES[group === "EXPENSE" ? "expense" : group === "INCOME" ? "income" : "savings"];
            return (
              <section key={group} className={cn(group === "EXPENSE" && "xl:row-span-2")}>
                <h2 className={cn("mb-1.5 flex items-center gap-2 px-1 text-sm font-semibold", tone.text)}>
                  <span className={cn("size-2.5 rounded-full", tone.bar)} />
                  {group === "EXPENSE" ? "Spending" : group === "INCOME" ? "Income" : "Savings"}
                </h2>
                <ul className={cn("divide-y overflow-hidden rounded-xl border border-l-4 bg-card", tone.edge)}>
                  {list
                    .sort((a, b) => (b.percent ?? 1000) - (a.percent ?? 1000))
                    .map((r) => (
                      <li key={r.key} className="grid gap-1.5 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{r.label}</span>
                          <span className="shrink-0 tabular-nums">
                            {money(r.actual)} <span className="text-muted-foreground">/ {r.budget > BigInt(0) ? money(r.budget) : "no budget"}</span>
                          </span>
                        </div>
                        {r.budget > BigInt(0) && (
                          <div className="flex items-center gap-3">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className={cn(
                                  "block h-full rounded-full",
                                  r.status === "over" ? "bg-destructive" : r.status === "near" ? "bg-tone-assets" : "bg-tone-income",
                                )}
                                style={{ width: `${Math.min(100, r.percent ?? 0)}%` }}
                              />
                            </span>
                            <span className={cn("shrink-0 text-xs tabular-nums", r.status === "over" ? "font-medium text-destructive" : "text-muted-foreground")}>
                              {r.percent?.toFixed(0)}% ·{" "}
                              {group === "EXPENSE"
                                ? r.remaining >= BigInt(0)
                                  ? `${money(r.remaining)} left`
                                  : `${money(-r.remaining)} over budget`
                                : r.remaining > BigInt(0)
                                  ? `${money(r.remaining)} still to come`
                                  : `${money(-r.remaining)} more than planned`}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
          </div>
          {user.lateIncomeDay && (
            <p className="text-xs text-muted-foreground">Income uses your late income shift: received on or after day {user.lateIncomeDay} counts toward the next month.</p>
          )}
        </>
      )}
    </>
  );
}
