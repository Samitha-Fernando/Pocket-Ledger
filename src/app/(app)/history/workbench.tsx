"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { selectClass } from "@/components/entry-form";
import { FormMessage } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatIsoDate, formatMonth } from "@/lib/format";
import { ASSET_CLASSES } from "@/lib/ledger/asset-classes";
import type { BulkOp } from "@/lib/ledger/bulk";
import type { EntryView } from "@/lib/ledger/describe";
import { cn } from "@/lib/utils";
import { bulkAction } from "./actions";

export type Opt = { value: string; label: string };
export type WorkbenchRow = EntryView & { editable: boolean; categoryKey: string };
export type WorkbenchOptions = {
  categories: Opt[]; // expense + income categories (labelled)
  payFrom: Opt[]; // cash / bank / savings / cards
  money: Opt[]; // cash / bank / savings (transfer targets)
  assets: Opt[];
  loans: Opt[];
  debts: Opt[];
};

const OPS: { value: BulkOp["op"]; label: string }[] = [
  { value: "category", label: "Change category" },
  { value: "account", label: "Change account" },
  { value: "linkAsset", label: "Link to an asset (expenses)" },
  { value: "linkLoan", label: "Link to a loan (income)" },
  { value: "toAsset", label: "Convert expenses to assets" },
  { value: "toTransfer", label: "Convert expenses to transfers" },
  { value: "toDebtPayment", label: "Convert expenses to a card / loan payment" },
  { value: "delete", label: "Delete" },
];

const PAGE = 200;

export function Workbench({
  rows,
  group,
  currency,
  options,
}: {
  rows: WorkbenchRow[];
  group: "day" | "month" | "category";
  currency: string;
  options: WorkbenchOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [op, setOp] = useState<BulkOp["op"]>("category");
  const [value, setValue] = useState("");
  const [assetClass, setAssetClass] = useState("OTHER");
  const [lifeYears, setLifeYears] = useState("5");
  const [message, setMessage] = useState<{ error?: string; success?: string }>();

  const editable = rows.filter((r) => r.editable);
  const visible = rows.slice(0, shown);
  const groups = useMemo(() => {
    const out = new Map<string, WorkbenchRow[]>();
    for (const r of visible) {
      const key = group === "month" ? r.date.slice(0, 7) : group === "category" ? r.categoryKey : r.date;
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return [...out];
  }, [visible, group]);
  const heading = (key: string) => (group === "month" ? formatMonth(key) : group === "category" ? key : formatIsoDate(key));

  const choices: Record<string, Opt[] | null> = {
    category: options.categories,
    account: options.payFrom,
    linkAsset: [{ value: "", label: "Unlink (no asset)" }, ...options.assets],
    linkLoan: [{ value: "", label: "Unlink (no loan)" }, ...options.loans],
    toTransfer: options.money,
    toDebtPayment: options.debts,
    toAsset: null,
    delete: null,
  };
  const list = choices[op];
  const current = value || list?.[0]?.value || "";

  function buildOp(): BulkOp | null {
    switch (op) {
      case "category":
        return { op, categoryId: current };
      case "account":
        return { op, accountId: current };
      case "linkAsset":
        return { op, assetId: value || null };
      case "linkLoan":
        return { op, loanId: value || null };
      case "toTransfer":
        return { op, toAccountId: current };
      case "toDebtPayment":
        return { op, debtId: current };
      case "toAsset":
        return { op, assetClass, lifeMonths: Math.round(Number(lifeYears) * 12) };
      case "delete":
        return { op };
    }
  }

  function apply() {
    const bulk = buildOp();
    if (!bulk) return;
    if (op === "delete" && !window.confirm(`Delete ${selected.size} transaction(s)? Their edit history is kept.`)) return;
    if (op !== "delete" && !window.confirm(`Apply “${OPS.find((o) => o.value === op)?.label}” to ${selected.size} transaction(s)?`)) return;
    startTransition(async () => {
      const result = await bulkAction([...selected], bulk);
      setMessage(result);
      setSelected(new Set());
      router.refresh();
    });
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={editable.length > 0 && editable.every((r) => selected.has(r.id))}
            onChange={(e) => setSelected(e.target.checked ? new Set(editable.map((r) => r.id)) : new Set())}
            aria-label="Select all that match"
          />
          Select all {editable.length} editable
        </label>
        {rows.length > editable.length && (
          <span className="text-xs text-muted-foreground">
            {rows.length - editable.length} asset, lending or card/loan movement(s) can only be changed on their own pages.
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 grid gap-2 rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={op}
              onChange={(e) => {
                setOp(e.target.value as BulkOp["op"]);
                setValue("");
              }}
              className={selectClass}
              aria-label="Bulk action"
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {list ? (
              <select value={value || (op === "linkAsset" || op === "linkLoan" ? "" : current)} onChange={(e) => setValue(e.target.value)} className={selectClass} aria-label="To">
                {list.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : op === "toAsset" ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={assetClass}
                  onChange={(e) => {
                    setAssetClass(e.target.value);
                    setLifeYears(String(ASSET_CLASSES[e.target.value as keyof typeof ASSET_CLASSES].lifeMonths / 12));
                  }}
                  className={selectClass}
                  aria-label="Asset class"
                >
                  {Object.entries(ASSET_CLASSES).map(([k, c]) => (
                    <option key={k} value={k}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <Input type="number" min={0} max={50} step={0.5} value={lifeYears} onChange={(e) => setLifeYears(e.target.value)} className="h-11 w-24" aria-label="Useful life in years" title="Useful life (years)" />
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" className={cn("h-11", op === "delete" && "bg-destructive text-white hover:bg-destructive/90")} disabled={pending} onClick={apply}>
                {pending && <Loader2Icon className="animate-spin" />} Apply
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}

      {message && <FormMessage state={message} />}

      {groups.map(([key, list]) => (
        <section key={key}>
          <h2 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{heading(key)}</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {list.map((r) => (
              <div key={r.id} className="flex items-center">
                <label className="flex w-10 shrink-0 justify-center self-stretch" title={r.editable ? "Select" : "Change this on its own page"}>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary disabled:opacity-30"
                    disabled={!r.editable}
                    checked={selected.has(r.id)}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                    aria-label={`Select ${r.details ?? r.categoryKey} on ${formatIsoDate(r.date)}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <EntryRow
                    entry={r}
                    currency={currency}
                    trailing={group !== "day" ? <span className="block text-xs text-muted-foreground">{formatIsoDate(r.date)}</span> : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {rows.length > shown && (
        <Button type="button" variant="outline" className="h-11" onClick={() => setShown(shown + PAGE)}>
          Show more ({rows.length - shown} left)
        </Button>
      )}
    </div>
  );
}
