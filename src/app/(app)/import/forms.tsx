"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { selectClass } from "@/components/entry-form";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIsoDate, formatMoney } from "@/lib/format";
import { ASSET_CLASSES } from "@/lib/ledger/asset-classes";
import { cn } from "@/lib/utils";
import type { RowPatch } from "@/lib/import/batch";
import { postAction, saveMappingAction, updateRowsAction, uploadAction } from "./actions";

export type Opt = { value: string; label: string };

// ---- Upload --------------------------------------------------------------------

export function UploadForm() {
  const [state, action] = useActionState(uploadAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="file">Excel file</Label>
        <Input id="file" name="file" type="file" accept=".xlsx,.xlsm,.xls" required className="h-11 py-2 text-sm" />
        <p className="text-xs text-muted-foreground">Up to 5 MB.</p>
      </div>
      <FormMessage state={state} />
      <SubmitButton>Upload and read</SubmitButton>
    </form>
  );
}

// ---- Step 1: mapping --------------------------------------------------------------

export type MappingKey = { key: string; count: number; total: number; value: string; options: Opt[] };

export function MappingForm({
  batchId,
  accounts,
  accountId,
  startingBalance,
  startingDate,
  keys,
  lateIncomeDay,
  currency,
  readOnly,
}: {
  batchId: string;
  accounts: Opt[];
  accountId: string | null;
  startingBalance: string;
  startingDate: string;
  keys: MappingKey[];
  lateIncomeDay: number | null;
  currency: string;
  readOnly: boolean;
}) {
  const [state, action] = useActionState(saveMappingAction, undefined);
  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="batchId" value={batchId} />
      <fieldset disabled={readOnly} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="accountId">The spreadsheet tracked this account</Label>
          <select id="accountId" name="accountId" defaultValue={accountId ?? accounts[0]?.value} className={selectClass} required>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Income goes into it, expenses and savings come out of it. You can move single rows later.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Balance before the first row" name="startingBalance" inputMode="decimal" defaultValue={startingBalance} hint="0 if the first row was your first money in." />
          <Field label="On" name="startingDate" type="date" defaultValue={startingDate} />
        </div>
        {lateIncomeDay && (
          <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
            <input type="checkbox" name="useLateIncome" defaultChecked className="mt-0.5 size-4 accent-primary" />
            <input type="hidden" name="lateIncomeDay" value={lateIncomeDay} />
            <span>
              <strong>Late income shift</strong> is on in your spreadsheet: income on or after day {lateIncomeDay} counts toward the next month. Use
              the same setting for reports here.
            </span>
          </label>
        )}
      </fieldset>

      <section>
        <h3 className="mb-2 text-sm font-medium">What each spreadsheet category becomes</h3>
        <div className="divide-y rounded-xl border">
          {keys.map((k) => (
            <div key={k.key} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr] sm:items-center">
              <div>
                <p className="font-medium">{k.key}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {k.count} row{k.count === 1 ? "" : "s"} · {formatMoney(k.total, currency)}
                </p>
              </div>
              <select name={`map::${k.key}`} defaultValue={k.value} className={selectClass} disabled={readOnly} aria-label={`What ${k.key} becomes`}>
                {k.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <FormMessage state={state} />
      {!readOnly && <SubmitButton>Save and review rows</SubmitButton>}
    </form>
  );
}

// ---- Step 2: review ------------------------------------------------------------------

export type ReviewRow = {
  id: string;
  rowNumber: number;
  date: string | null;
  type: string;
  category: string;
  amount: number | null;
  details: string | null;
  action: string;
  targetId: string | null;
  note: string | null;
  duplicate: boolean;
  posted: boolean;
  assetName: string | null;
  assetClass: string | null;
  lifeMonths: number | null;
  loanId: string | null;
};

export type ReviewOptions = Record<"EXPENSE" | "INCOME" | "TRANSFER" | "DEBT_PAYMENT", Opt[]> & { loans: Opt[] };

const ACTION_LABELS: Record<string, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER: "Transfer to savings",
  ASSET: "Asset",
  DEBT_PAYMENT: "Card / loan payment",
  SKIP: "Skip (don't import)",
  REVIEW: "Needs a decision",
};

const FILTERS = {
  all: { label: "All", test: () => true },
  review: { label: "Needs a decision", test: (r: ReviewRow) => r.action === "REVIEW" },
  asset: { label: "Assets", test: (r: ReviewRow) => r.action === "ASSET" || /asset/i.test(r.category) },
  debt: { label: "Debt", test: (r: ReviewRow) => r.action === "DEBT_PAYMENT" || /debt/i.test(r.category) },
  skip: { label: "Skipped", test: (r: ReviewRow) => r.action === "SKIP" && !r.duplicate },
  duplicate: { label: "Already imported", test: (r: ReviewRow) => r.duplicate },
} as const;

const PAGE = 50;

export function ReviewTable({
  batchId,
  rows,
  options,
  currency,
  readOnly,
}: {
  batchId: string;
  rows: ReviewRow[];
  options: ReviewOptions;
  currency: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<keyof typeof FILTERS>(rows.some((r) => r.action === "REVIEW") ? "review" : "all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ error?: string; success?: string }>();
  const [bulkAction, setBulkAction] = useState("EXPENSE");
  const [bulkTarget, setBulkTarget] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(FILTERS[filter].test)
      .filter((r) => !q || `${r.details ?? ""} ${r.category} ${r.type} ${r.rowNumber}`.toLowerCase().includes(q));
  }, [rows, filter, search]);
  const pageRows = visible.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));

  const apply = (ids: string[], patch: RowPatch) =>
    startTransition(async () => {
      const result = await updateRowsAction(batchId, ids, patch);
      setMessage(result);
      router.refresh();
    });

  const targetsFor = (action: string) => (options as Record<string, Opt[]>)[action] ?? null;
  const firstTarget = (action: string) => targetsFor(action)?.[0]?.value ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => {
          const count = rows.filter(FILTERS[k].test).length;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setFilter(k);
                setPage(0);
              }}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                filter === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                k === "review" && count > 0 && filter !== k && "border-amber-500 text-amber-700 dark:text-amber-400",
              )}
            >
              {FILTERS[k].label} ({count})
            </button>
          );
        })}
      </div>
      <Input
        placeholder="Search details, category or row number…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        className="h-11 text-base md:text-sm"
      />

      {!readOnly && selected.size > 0 && (
        <div className="sticky top-16 z-20 grid gap-2 rounded-xl border bg-card p-3 shadow-sm sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <select
            value={bulkAction}
            onChange={(e) => {
              setBulkAction(e.target.value);
              setBulkTarget(firstTarget(e.target.value) ?? "");
            }}
            className={selectClass}
            aria-label="Set selected rows to"
          >
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {targetsFor(bulkAction) ? (
            <select value={bulkTarget || firstTarget(bulkAction) || ""} onChange={(e) => setBulkTarget(e.target.value)} className={selectClass} aria-label="Category or account">
              {targetsFor(bulkAction)!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-10"
              disabled={pending}
              onClick={() => {
                apply([...selected], { action: bulkAction as RowPatch["action"], ...(targetsFor(bulkAction) && { targetId: bulkTarget || firstTarget(bulkAction) }) });
                setSelected(new Set());
              }}
            >
              Apply
            </Button>
            <Button type="button" variant="ghost" className="h-10" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {message?.error && <FormMessage state={{ error: message.error }} />}
      {pending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Saving…
        </p>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          {!readOnly && (
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={pageRows.length > 0 && pageRows.filter((r) => !r.posted).every((r) => selected.has(r.id))}
              onChange={(e) => {
                const next = new Set(selected);
                for (const r of pageRows) {
                  if (r.posted) continue;
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                }
                setSelected(next);
              }}
              aria-label="Select all rows on this page"
            />
          )}
          {visible.length} row{visible.length === 1 ? "" : "s"}
        </label>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            {page + 1} / {pages}
            <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </span>
        )}
      </div>

      <ul className="grid gap-2">
        {pageRows.map((r) => {
          const locked = readOnly || r.posted;
          const targets = targetsFor(r.action);
          return (
            <li key={r.id} className={cn("rounded-xl border bg-card p-3", r.action === "REVIEW" && "border-amber-500/60", r.duplicate && "opacity-60")}>
              <div className="flex items-start gap-3">
                {!locked && (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={selected.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setSelected(next);
                    }}
                    aria-label={`Select row ${r.rowNumber}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="font-medium">
                      {r.type} / {r.category}
                    </p>
                    <p className="font-medium tabular-nums">{r.amount === null ? "—" : formatMoney(r.amount, currency)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Row {r.rowNumber} · {r.date ? formatIsoDate(r.date) : "no date"}
                    {r.details && ` · ${r.details}`}
                  </p>
                  {r.note && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <TriangleAlertIcon className="size-3.5" /> {r.note}
                    </p>
                  )}
                  {r.posted && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <CheckIcon className="size-3.5" /> Posted
                    </p>
                  )}

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={r.action}
                      disabled={locked || pending}
                      onChange={(e) => apply([r.id], { action: e.target.value as RowPatch["action"], ...(targetsFor(e.target.value) && { targetId: firstTarget(e.target.value) }) })}
                      className={cn(selectClass, "h-10")}
                      aria-label={`Row ${r.rowNumber} becomes`}
                    >
                      {Object.entries(ACTION_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {targets && (
                      <select
                        value={r.targetId ?? ""}
                        disabled={locked || pending}
                        onChange={(e) => apply([r.id], { targetId: e.target.value })}
                        className={cn(selectClass, "h-10")}
                        aria-label={`Row ${r.rowNumber} category or account`}
                      >
                        {!r.targetId && <option value="">Choose…</option>}
                        {targets.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.action === "INCOME" && options.loans.length > 0 && (
                      <select
                        value={r.loanId ?? ""}
                        disabled={locked || pending}
                        onChange={(e) => apply([r.id], { loanId: e.target.value || null })}
                        className={cn(selectClass, "h-10 sm:col-span-2")}
                        aria-label={`Row ${r.rowNumber} linked loan`}
                      >
                        <option value="">Not linked to a loan</option>
                        {options.loans.map((o) => (
                          <option key={o.value} value={o.value}>
                            From: {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.action === "ASSET" && (
                      <>
                        <Input
                          defaultValue={r.assetName ?? ""}
                          disabled={locked}
                          maxLength={80}
                          onBlur={(e) => {
                            if (e.target.value !== (r.assetName ?? "")) apply([r.id], { assetName: e.target.value });
                          }}
                          className="h-10"
                          aria-label={`Row ${r.rowNumber} asset name`}
                          placeholder="Asset name"
                        />
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <select
                            value={r.assetClass ?? "OTHER"}
                            disabled={locked || pending}
                            onChange={(e) =>
                              apply([r.id], { assetClass: e.target.value, lifeMonths: ASSET_CLASSES[e.target.value as keyof typeof ASSET_CLASSES].lifeMonths })
                            }
                            className={cn(selectClass, "h-10")}
                            aria-label={`Row ${r.rowNumber} asset class`}
                          >
                            {Object.entries(ASSET_CLASSES).map(([k, c]) => (
                              <option key={k} value={k}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <Input
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            defaultValue={(r.lifeMonths ?? 60) / 12}
                            disabled={locked}
                            onBlur={(e) => {
                              const months = Math.round(Number(e.target.value) * 12);
                              if (months !== r.lifeMonths) apply([r.id], { lifeMonths: months });
                            }}
                            className="h-10 w-24"
                            aria-label={`Row ${r.rowNumber} useful life in years`}
                            title="Useful life (years)"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- Step 3: post ------------------------------------------------------------------------

export function PostForm({ batchId, disabled }: { batchId: string; disabled: boolean }) {
  const [state, action] = useActionState(postAction, undefined);
  return (
    <form
      action={action}
      className="grid gap-3"
      onSubmit={(e) => {
        if (!window.confirm("Post these rows as real transactions? You can undo the whole import afterwards.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="batchId" value={batchId} />
      <FormMessage state={state} />
      <SubmitButton className={cn(disabled && "pointer-events-none opacity-50")}>Post to my books</SubmitButton>
    </form>
  );
}
