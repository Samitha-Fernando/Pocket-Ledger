"use client";

import { useActionState } from "react";
import { selectClass } from "@/components/entry-form";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { applyBudgetDraftAction, uploadBudgetAction } from "../actions";

export function BudgetUploadForm() {
  const [state, action] = useActionState(uploadBudgetAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="file">Excel file</Label>
        <Input id="file" name="file" type="file" accept=".xlsx,.xlsm,.xls" required className="h-11 py-2 text-sm" />
      </div>
      <FormMessage state={state} />
      <SubmitButton>Read the Budget Planning sheet</SubmitButton>
    </form>
  );
}

export type PreviewLine = {
  group: string;
  label: string;
  months: number;
  total: number;
  years: string;
  target: string; // "" = skip
  options: { value: string; label: string }[];
};

export function BudgetPreviewForm({ draftId, lines, currency, replaces }: { draftId: string; lines: PreviewLine[]; currency: string; replaces: string[] }) {
  const [state, action] = useActionState(applyBudgetDraftAction, undefined);
  return (
    <form
      action={action}
      className="grid gap-4"
      onSubmit={(e) => {
        if (replaces.length && !window.confirm(`${replaces.length} month(s) already have budgets. The lines you import will replace those months. Continue?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="count" value={lines.length} />
      <div className="divide-y rounded-xl border">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr] sm:items-center">
            <div>
              <p className="font-medium">
                {l.label} <span className="text-xs font-normal text-muted-foreground">({l.group.toLowerCase()})</span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {l.months} month{l.months === 1 ? "" : "s"} in {l.years} · {formatMoney(l.total, currency)} in total
              </p>
            </div>
            <select name={`line-${i}`} defaultValue={l.target} className={selectClass} aria-label={`Where ${l.label} goes`}>
              <option value="">Don&apos;t import</option>
              {l.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton>Save these budgets</SubmitButton>
    </form>
  );
}
