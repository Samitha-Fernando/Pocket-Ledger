"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, Loader2Icon, RepeatIcon } from "lucide-react";
import { FormMessage } from "@/components/form-bits";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copyMonthAction, fillYearAction, setBudgetAction } from "./actions";

export type GridLine = { key: string; label: string; group: "INCOME" | "EXPENSE" | "SAVINGS" };

const GROUPS = [
  { group: "INCOME", label: "Income" },
  { group: "EXPENSE", label: "Expenses" },
  { group: "SAVINGS", label: "Savings" },
] as const;
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Budget plan for one year: a spreadsheet-like grid on large screens, one month at a time on phones. */
export function BudgetGrid({
  year,
  lines,
  initial,
  currency,
  currentMonth,
}: {
  year: number;
  lines: GridLine[];
  initial: Record<string, Record<string, number>>; // key → month → cents
  currency: string;
  currentMonth: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
  // When the server sends fresh numbers (after copy / fill), use them.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValues(initial);
  }
  const [message, setMessage] = useState<{ error?: string; success?: string }>();
  const months = SHORT.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const [mobileMonth, setMobileMonth] = useState(months.includes(currentMonth) ? currentMonth : months[0]);
  const money = (c: number) => formatMoney(c, currency).replace(/\.00$/, "");

  const get = (key: string, m: string) => values[key]?.[m] ?? 0;
  const total = (group: string, m: string) => lines.filter((l) => l.group === group).reduce((s, l) => s + get(l.key, m), 0);
  const allocated = (m: string) => total("INCOME", m) - total("EXPENSE", m) - total("SAVINGS", m);
  const yearTotal = (fn: (m: string) => number) => months.reduce((s, m) => s + fn(m), 0);

  const run = (fn: () => Promise<{ error?: string; success?: string } | undefined>, refresh = true) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result);
      if (refresh) router.refresh();
    });

  function save(key: string, m: string, text: string) {
    const cents = text.trim() === "" ? 0 : parseMoneyToCents(text);
    if (cents === null || cents < 0) {
      setMessage({ error: "Enter an amount like 25,000 (or leave it empty)." });
      return;
    }
    if (cents === get(key, m)) return;
    setValues((v) => ({ ...v, [key]: { ...v[key], [m]: cents } }));
    run(() => setBudgetAction(m, key, text), false);
  }

  function sameEveryMonth(line: GridLine) {
    const source = get(line.key, mobileMonth) || months.map((m) => get(line.key, m)).find((v) => v > 0) || 0;
    if (!window.confirm(`Set “${line.label}” to ${money(source)} for every month of ${year}?`)) return;
    setValues((v) => ({ ...v, [line.key]: Object.fromEntries(months.map((m) => [m, source])) }));
    run(() => fillYearAction(year, line.key, centsToInput(source)));
  }

  function copyPrevious(m: string) {
    const i = months.indexOf(m);
    const prev = i > 0 ? months[i - 1] : `${year - 1}-12`;
    if (!window.confirm(`Copy the whole budget from ${prev} into ${m}? This replaces ${m}.`)) return;
    run(() => copyMonthAction(prev, m));
  }

  const cell = (line: GridLine, m: string, className?: string) => (
    <input
      key={`${line.key}-${m}-${get(line.key, m)}`}
      defaultValue={get(line.key, m) ? centsToInput(get(line.key, m)).replace(/\.00$/, "") : ""}
      inputMode="decimal"
      onBlur={(e) => save(line.key, m, e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn("w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right tabular-nums outline-none hover:border-input focus:border-ring focus:bg-background", className)}
      aria-label={`${line.label} budget for ${m}`}
      placeholder="—"
    />
  );

  return (
    <div className="grid gap-3">
      {message?.error && <FormMessage state={message} />}
      {pending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Saving…
        </p>
      )}

      {/* Large screens: the whole year */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Line</th>
              {months.map((m, i) => (
                <th key={m} className={cn("px-1 py-2 text-right font-medium", m === currentMonth && "text-primary")}>
                  <span className="flex items-center justify-end gap-1">
                    {SHORT[i]}
                    <button type="button" onClick={() => copyPrevious(m)} title="Copy the previous month here" aria-label={`Copy previous month into ${SHORT[i]}`} className="rounded p-0.5 hover:bg-muted">
                      <CopyIcon className="size-3" />
                    </button>
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Year</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(({ group, label }) => (
              <GroupRows key={group}>
                <tr className="bg-muted/50">
                  <td colSpan={14} className="sticky left-0 px-3 py-1.5 text-xs font-semibold tracking-wide uppercase">
                    {label}
                  </td>
                </tr>
                {lines
                  .filter((l) => l.group === group)
                  .map((line) => (
                    <tr key={line.key} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 max-w-48 bg-card px-3 py-0.5">
                        <span className="flex items-center gap-1">
                          <span className="truncate">{line.label}</span>
                          <button type="button" onClick={() => sameEveryMonth(line)} title="Same amount every month" aria-label={`Same every month for ${line.label}`} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted">
                            <RepeatIcon className="size-3.5" />
                          </button>
                        </span>
                      </td>
                      {months.map((m) => (
                        <td key={m} className="px-0.5">
                          {cell(line, m)}
                        </td>
                      ))}
                      <td className="px-3 text-right text-muted-foreground tabular-nums">{money(months.reduce((s, m) => s + get(line.key, m), 0))}</td>
                    </tr>
                  ))}
                <tr className="border-b bg-muted/30 text-xs font-medium">
                  <td className="sticky left-0 bg-muted/30 px-3 py-1.5">Total {label.toLowerCase()}</td>
                  {months.map((m) => (
                    <td key={m} className="px-1.5 text-right tabular-nums">
                      {money(total(group, m))}
                    </td>
                  ))}
                  <td className="px-3 text-right tabular-nums">{money(yearTotal((m) => total(group, m)))}</td>
                </tr>
              </GroupRows>
            ))}
            <tr className="font-semibold">
              <td className="sticky left-0 bg-card px-3 py-2">To be allocated</td>
              {months.map((m) => (
                <td key={m} className={cn("px-1.5 text-right text-xs tabular-nums", allocated(m) < 0 && "text-destructive")}>
                  {money(allocated(m))}
                </td>
              ))}
              <td className={cn("px-3 text-right tabular-nums", yearTotal(allocated) < 0 && "text-destructive")}>{money(yearTotal(allocated))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Phones: one month at a time */}
      <div className="grid gap-3 md:hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {months.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMobileMonth(m)}
              className={cn("h-9 shrink-0 rounded-full border px-3 text-sm", m === mobileMonth ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {SHORT[i]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => copyPrevious(mobileMonth)} className="flex h-9 w-fit items-center gap-1.5 rounded-full border px-3 text-xs text-muted-foreground hover:bg-muted">
          <CopyIcon className="size-3.5" /> Copy the previous month here
        </button>
        {GROUPS.map(({ group, label }) => (
          <section key={group} className="rounded-xl border bg-card">
            <h3 className="flex justify-between border-b px-3 py-2 text-sm font-semibold">
              {label} <span className="tabular-nums">{money(total(group, mobileMonth))}</span>
            </h3>
            <ul className="divide-y">
              {lines
                .filter((l) => l.group === group)
                .map((line) => (
                  <li key={line.key} className="flex items-center gap-2 px-3 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
                    <button type="button" onClick={() => sameEveryMonth(line)} aria-label={`Same every month for ${line.label}`} className="rounded p-1 text-muted-foreground hover:bg-muted">
                      <RepeatIcon className="size-4" />
                    </button>
                    <span className="w-32">{cell(line, mobileMonth, "h-10 text-base")}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <p className={cn("flex justify-between rounded-xl border bg-card px-3 py-2 font-semibold", allocated(mobileMonth) < 0 && "text-destructive")}>
          To be allocated <span className="tabular-nums">{money(allocated(mobileMonth))}</span>
        </p>
      </div>
    </div>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
