import Link from "next/link";
import { FileSpreadsheetIcon, ReceiptTextIcon, SlidersHorizontalIcon, WandSparklesIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { selectClass } from "@/components/entry-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney, todayIso } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";
import { GROUPS, SORTS, TYPE_GROUPS, parseFilters, quickRanges, searchEntries } from "@/lib/ledger/search";
import { cn } from "@/lib/utils";
import { Workbench } from "./workbench";

export const metadata = { title: "History" };

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const params = await searchParams;
  const f = parseFilters(params, today);

  const [result, data, batches, debts] = await Promise.all([
    searchEntries(db, f),
    getFormData(db, user.assetThresholdCents),
    db.importBatch.findMany({ where: { status: "POSTED" }, select: { id: true, fileName: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.debt.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
  ]);
  const money = (c: number) => formatMoney(c, user.currency);
  const advanced = Boolean(f.types.length || f.accountId || f.categoryId || f.min || f.max || f.batchId || f.linked || f.sort !== "date-desc" || f.group !== "day");

  // Keep the other filters when switching the date range.
  const withRange = (from: string, to: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "from" || k === "to" || k === "month" || k === "range") continue;
      for (const one of Array.isArray(v) ? v : v ? [v] : []) p.append(k, one);
    }
    if (from || to) {
      p.set("from", from);
      p.set("to", to);
    } else p.set("range", "all");
    return `/history?${p.toString()}`;
  };
  const rangeLabel = !f.from && !f.to ? "All time" : `${f.from ? formatIsoDate(f.from) : "…"} – ${f.to ? formatIsoDate(f.to) : "…"}`;

  const categories = [
    ...data.expenseCategories.map((c) => ({ value: c.id, label: `${c.name} (expense)` })),
    ...data.incomeCategories.map((c) => ({ value: c.id, label: `${c.name} (income)` })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="History" description={rangeLabel} />
        <div className="flex gap-2">
          <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/history/rules" />} nativeButton={false}>
            <WandSparklesIcon /> Rules
          </Button>
          <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/import" />} nativeButton={false}>
            <FileSpreadsheetIcon /> Import
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {quickRanges(today).map((r) => {
          const active = r.from === f.from && r.to === f.to;
          return (
            <Link
              key={r.label}
              href={withRange(r.from, r.to)}
              className={cn("flex h-9 items-center rounded-full border px-3 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {/* Filters: a plain form, so the choices end up in the page address (bookmarkable). */}
      <form method="get" className="mb-4 grid gap-3 rounded-xl border bg-card p-3">
        <div className="flex gap-2">
          <Input name="q" defaultValue={f.q} placeholder="Search details…" className="h-11 flex-1 text-base md:text-sm" aria-label="Search details" />
          <Button type="submit" className="h-11">
            Search
          </Button>
        </div>
        <details open={advanced}>
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground select-none">
            <SlidersHorizontalIcon className="size-4" /> More filters
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={f.from} className="h-11" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={f.to} className="h-11" />
            </div>
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Type</legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TYPE_GROUPS).map(([key, g]) => (
                  <label key={key} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm has-checked:border-primary has-checked:bg-primary/10">
                    <input type="checkbox" name="type" value={key} defaultChecked={f.types.includes(key)} className="size-3.5 accent-primary" />
                    {g.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor="account">Account</Label>
              <select id="account" name="account" defaultValue={f.accountId} className={selectClass}>
                <option value="">Any</option>
                {data.payFrom.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" defaultValue={f.categoryId} className={selectClass}>
                <option value="">Any</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="min">Amount from</Label>
                <Input id="min" name="min" inputMode="decimal" defaultValue={f.min} className="h-11" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="max">to</Label>
                <Input id="max" name="max" inputMode="decimal" defaultValue={f.max} className="h-11" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="linked">Linked to</Label>
              <select id="linked" name="linked" defaultValue={f.linked} className={selectClass}>
                <option value="">Anything</option>
                <option value="asset">An asset</option>
                <option value="loan">A loan / investment</option>
              </select>
            </div>
            {batches.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="batch">From import</Label>
                <select id="batch" name="batch" defaultValue={f.batchId} className={selectClass}>
                  <option value="">Any</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.fileName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="sort">Sort</Label>
                <select id="sort" name="sort" defaultValue={f.sort} className={selectClass}>
                  {Object.entries(SORTS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="group">Group by</Label>
                <select id="group" name="group" defaultValue={f.group} className={selectClass}>
                  {Object.entries(GROUPS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" className="h-10">
              Apply filters
            </Button>
            <Button variant="ghost" className="h-10" render={<Link href="/history" />} nativeButton={false}>
              Reset
            </Button>
          </div>
        </details>
      </form>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="font-semibold tabular-nums">{result.totals.count}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Income</p>
          <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(result.totals.income)}</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Expenses</p>
          <p className="font-semibold tabular-nums">{money(result.totals.expenses)}</p>
        </div>
      </div>
      {result.truncated && <p className="mb-3 text-xs text-muted-foreground">Showing the first 5,000 matches. Narrow the filters to see the rest.</p>}

      {result.rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <ReceiptTextIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing matches</p>
          <Link href="/add" className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
            Add a transaction
          </Link>
        </div>
      ) : (
        <Workbench
          rows={result.rows}
          group={f.group}
          currency={user.currency}
          options={{
            categories,
            payFrom: data.payFrom.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
            money: data.assets.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })),
            assets: data.fixedAssets.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name })),
            loans: data.loans.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
            debts: debts.map((d) => ({ value: d.id, label: d.name })),
          }}
        />
      )}
    </>
  );
}
