"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, Loader2Icon, RepeatIcon } from "lucide-react";
import { FormMessage } from "@/components/form-bits";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copyMonthAction, fillYearAction, setBudgetAction } from "./actions";

export type GridLine = { key: string; label: string; group: "INCOME" | "EXPENSE" | "SAVINGS" };

// Each section has its own colour (same families as Home and Accounts). The "tint" classes
// paint a see-through colour over the card colour, so sticky cells stay solid when scrolling.
const GROUPS = [
  {
    group: "INCOME",
    label: "Income",
    edge: "border-l-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    head: "bg-card bg-linear-to-r from-emerald-500/15 to-emerald-500/15",
    total: "bg-card bg-linear-to-r from-emerald-500/8 to-emerald-500/8",
  },
  {
    group: "EXPENSE",
    label: "Expenses",
    edge: "border-l-pink-500",
    text: "text-pink-700 dark:text-pink-300",
    head: "bg-card bg-linear-to-r from-pink-500/15 to-pink-500/15",
    total: "bg-card bg-linear-to-r from-pink-500/8 to-pink-500/8",
  },
  {
    group: "SAVINGS",
    label: "Savings",
    edge: "border-l-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    head: "bg-card bg-linear-to-r from-sky-500/15 to-sky-500/15",
    total: "bg-card bg-linear-to-r from-sky-500/8 to-sky-500/8",
  },
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
  // Plain number with commas and no currency sign, for the grid (e.g. 185,000).
  const num = (c: number) => money(c).replace(/[^\d,.-]/g, "");

  const get = (key: string, m: string) => values[key]?.[m] ?? 0;
  const total = (group: string, m: string) => lines.filter((l) => l.group === group).reduce((s, l) => s + get(l.key, m), 0);
  const allocated = (m: string) => total("INCOME", m) - total("EXPENSE", m) - total("SAVINGS", m);
  const yearTotal = (fn: (m: string) => number) => months.reduce((s, m) => s + fn(m), 0);
  const lineYear = (key: string) => yearTotal((m) => get(key, m));

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
      defaultValue={get(line.key, m) ? num(get(line.key, m)) : ""}
      inputMode="decimal"
      onBlur={(e) => save(line.key, m, e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn(
        "h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-right tabular-nums outline-none placeholder:text-muted-foreground/40 hover:border-input focus:border-ring focus:bg-background",
        className,
      )}
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

      {/* Large screens: the whole year, like a spreadsheet. Line names and month headings stay put while scrolling. */}
      <div className="hidden max-h-[calc(100dvh-14rem)] min-h-96 overflow-auto rounded-xl border bg-card shadow-xs md:block">
        <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-[13px] 2xl:text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="sticky top-0 left-0 z-30 w-44 min-w-44 2xl:w-56 2xl:min-w-56 border-b bg-card px-3 py-2.5 text-left font-medium">
                Line <span className="font-normal">· amounts in {currency === "LKR" ? "Rs" : currency}</span>
              </th>
              {months.map((m, i) => (
                <th key={m} className={cn("sticky top-0 z-20 border-b bg-card px-1 py-2.5 text-right font-medium", m === currentMonth && "bg-linear-to-r from-primary/12 to-primary/12 text-primary")}>
                  <span className="flex items-center justify-end gap-1">
                    {SHORT[i]}
                    <button type="button" onClick={() => copyPrevious(m)} title="Copy the previous month here" aria-label={`Copy previous month into ${SHORT[i]}`} className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100">
                      <CopyIcon className="size-3" />
                    </button>
                  </span>
                </th>
              ))}
              <th className="sticky top-0 right-0 z-30 w-24 2xl:w-28 border-b border-l bg-card px-2 py-2.5 text-right font-semibold text-foreground">Year</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => {
              const groupLines = lines.filter((l) => l.group === g.group);
              return (
                <GroupRows key={g.group}>
                  <tr>
                    <td className={cn("sticky left-0 z-10 border-b border-l-4 px-3 py-2 text-xs font-semibold tracking-wide uppercase", g.head, g.edge, g.text)}>{g.label}</td>
                    <td colSpan={12} className={cn("border-b", g.head)} />
                    <td className={cn("sticky right-0 z-10 border-b border-l", g.head)} />
                  </tr>
                  {groupLines.map((line) => (
                    <tr key={line.key} className="group/row h-10">
                      <td className={cn("sticky left-0 z-10 w-44 min-w-44 2xl:w-56 2xl:min-w-56 border-b border-l-4 bg-card px-3 group-hover/row:bg-muted", g.edge)}>
                        <span className="flex items-center gap-1">
                          <span className="truncate" title={line.label}>
                            {line.label}
                          </span>
                          <button type="button" onClick={() => sameEveryMonth(line)} title="Same amount every month" aria-label={`Same every month for ${line.label}`} className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                            <RepeatIcon className="size-3.5" />
                          </button>
                        </span>
                      </td>
                      {months.map((m) => (
                        <td key={m} className={cn("border-b px-0.5 group-hover/row:bg-muted/50", m === currentMonth && "bg-primary/6")}>
                          {cell(line, m)}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border-b border-l bg-card px-2 text-right whitespace-nowrap text-muted-foreground tabular-nums group-hover/row:bg-muted">
                        {lineYear(line.key) ? num(lineYear(line.key)) : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="h-10 font-semibold">
                    <td className={cn("sticky left-0 z-10 border-b border-l-4 px-3", g.total, g.edge)}>Total {g.label.toLowerCase()}</td>
                    {months.map((m) => (
                      <td key={m} className={cn("border-b px-1 text-right whitespace-nowrap tabular-nums", g.total, g.text)}>
                        {num(total(g.group, m))}
                      </td>
                    ))}
                    <td className={cn("sticky right-0 z-10 border-b border-l px-2 text-right whitespace-nowrap tabular-nums", g.total, g.text)}>{num(yearTotal((m) => total(g.group, m)))}</td>
                  </tr>
                </GroupRows>
              );
            })}
            <tr className="h-11 font-semibold">
              <td className="sticky left-0 z-10 border-l-4 border-l-primary bg-card bg-linear-to-r from-muted to-muted px-3" title="Income − expenses − savings">
                To be allocated
              </td>
              {months.map((m) => (
                <td key={m} className={cn("bg-muted px-1 text-right whitespace-nowrap tabular-nums", allocated(m) < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>
                  {num(allocated(m))}
                </td>
              ))}
              <td
                className={cn(
                  "sticky right-0 z-10 border-l bg-card bg-linear-to-r from-muted to-muted px-2 text-right whitespace-nowrap tabular-nums",
                  yearTotal(allocated) < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {num(yearTotal(allocated))}
              </td>
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
        {GROUPS.map(({ group, label, edge, text, head }) => (
          <section key={group} className={cn("overflow-hidden rounded-xl border border-l-4 bg-card", edge)}>
            <h3 className={cn("flex justify-between border-b px-3 py-2 text-sm font-semibold", head, text)}>
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
        <p className={cn("flex justify-between rounded-xl border border-l-4 border-l-primary bg-muted px-3 py-2 font-semibold", allocated(mobileMonth) < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>
          To be allocated <span className="tabular-nums">{money(allocated(mobileMonth))}</span>
        </p>
      </div>
    </div>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
