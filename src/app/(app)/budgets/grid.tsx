"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, CopyIcon, Loader2Icon, RepeatIcon } from "lucide-react";
import { FormMessage } from "@/components/form-bits";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copyMonthAction, fillYearAction, setBudgetAction } from "./actions";

export type GridLine = { key: string; label: string; group: "INCOME" | "EXPENSE" | "SAVINGS" };

// Each section is marked by its money colour (palette tokens in globals.css): a small dot,
// never a coloured band, so the numbers stay the focus.
const GROUPS = [
  { group: "INCOME", label: "Income", dot: "bg-tone-income" },
  { group: "EXPENSE", label: "Expenses", dot: "bg-tone-expense" },
  { group: "SAVINGS", label: "Savings", dot: "bg-tone-savings" },
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
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (group: string) => setCollapsed((c) => (c.includes(group) ? c.filter((g) => g !== group) : [...c, group]));
  const money = (c: number) => formatMoney(c, currency).replace(/\.00$/, "");
  // Plain number with commas and no currency sign, for the grid (e.g. 185,000).
  const num = (c: number) => money(c).replace(/[^\d,.-]/g, "");

  const get = (key: string, m: string) => values[key]?.[m] ?? 0;
  const total = (group: string, m: string) => lines.filter((l) => l.group === group).reduce((s, l) => s + get(l.key, m), 0);
  const allocated = (m: string) => total("INCOME", m) - total("EXPENSE", m) - total("SAVINGS", m);
  const yearTotal = (fn: (m: string) => number) => months.reduce((s, m) => s + fn(m), 0);
  const lineYear = (key: string) => yearTotal((m) => get(key, m));
  const avg = (n: number) => Math.round(n / 12);

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

      {/* Large screens: the whole year, like a spreadsheet. Line names, month headings and totals stay put while scrolling. */}
      <div className="hidden max-h-[calc(100dvh-14rem)] min-h-96 overflow-auto rounded-xl border bg-card shadow-xs md:block">
        <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-[13px] 2xl:text-sm">
          <thead>
            <tr className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <th className="sticky top-0 left-0 z-30 w-44 min-w-44 border-b bg-card px-3 py-2.5 text-left font-medium 2xl:w-56 2xl:min-w-56">
                Line <span className="tracking-normal normal-case">· in {currency === "LKR" ? "Rs" : currency}</span>
              </th>
              {months.map((m, i) => (
                <th
                  key={m}
                  className={cn("sticky top-0 z-20 border-b bg-card px-1 py-2.5 text-right font-medium", m === currentMonth && "text-primary shadow-[inset_0_-2px_0_var(--color-primary)]")}
                >
                  <span className="flex items-center justify-end gap-1">
                    {SHORT[i]}
                    <button type="button" onClick={() => copyPrevious(m)} title="Copy the previous month here" aria-label={`Copy previous month into ${SHORT[i]}`} className="rounded p-0.5 opacity-40 hover:bg-muted hover:opacity-100">
                      <CopyIcon className="size-3" />
                    </button>
                  </span>
                </th>
              ))}
              <th className="sticky top-0 z-20 hidden w-24 border-b border-l bg-card px-2 py-2.5 text-right font-medium 2xl:table-cell">Avg / mo</th>
              <th className="sticky top-0 right-0 z-30 w-24 border-b border-l bg-card px-2 py-2.5 text-right font-semibold text-foreground 2xl:w-28">Year</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => {
              const groupLines = lines.filter((l) => l.group === g.group);
              const open = !collapsed.includes(g.group);
              const groupYear = yearTotal((m) => total(g.group, m));
              return (
                <GroupRows key={g.group}>
                  <tr>
                    <td className="sticky left-0 z-10 border-b bg-muted px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggle(g.group)}
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 rounded px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
                      >
                        <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
                        <span className={cn("size-2 rounded-full", g.dot)} />
                        {g.label}
                        <span className="font-normal tracking-normal normal-case">{groupLines.length}</span>
                      </button>
                    </td>
                    <td colSpan={12} className="border-b bg-muted" />
                    <td className="hidden border-b border-l bg-muted 2xl:table-cell" />
                    <td className="sticky right-0 z-10 border-b border-l bg-muted" />
                  </tr>
                  {open &&
                    groupLines.map((line) => (
                      <tr key={line.key} className="group/row h-9">
                        <td className="sticky left-0 z-10 w-44 min-w-44 border-b border-border/60 bg-card px-3 group-hover/row:bg-muted 2xl:w-56 2xl:min-w-56">
                          <span className="flex items-center gap-1">
                            <span className="truncate" title={line.label}>
                              {line.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => sameEveryMonth(line)}
                              title="Same amount every month"
                              aria-label={`Same every month for ${line.label}`}
                              className="ml-auto shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
                            >
                              <RepeatIcon className="size-3.5" />
                            </button>
                          </span>
                        </td>
                        {months.map((m) => (
                          <td key={m} className={cn("border-b border-border/60 px-0.5 group-hover/row:bg-muted/60", m === currentMonth && "bg-primary/5")}>
                            {cell(line, m)}
                          </td>
                        ))}
                        <td className="hidden border-b border-l border-border/60 px-2 text-right whitespace-nowrap text-muted-foreground tabular-nums group-hover/row:bg-muted/60 2xl:table-cell">
                          {lineYear(line.key) ? num(avg(lineYear(line.key))) : "—"}
                        </td>
                        <td className="sticky right-0 z-10 border-b border-l border-border/60 bg-card px-2 text-right font-medium whitespace-nowrap tabular-nums group-hover/row:bg-muted">
                          {lineYear(line.key) ? num(lineYear(line.key)) : <span className="text-muted-foreground/50">—</span>}
                        </td>
                      </tr>
                    ))}
                  <tr className="h-10 font-semibold">
                    <td className="sticky left-0 z-10 border-b bg-card px-3">
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", g.dot)} />
                        Total {g.label.toLowerCase()}
                      </span>
                    </td>
                    {months.map((m) => (
                      <td key={m} className={cn("border-b px-1 text-right whitespace-nowrap tabular-nums", m === currentMonth && "bg-primary/5")}>
                        {num(total(g.group, m))}
                      </td>
                    ))}
                    <td className="hidden border-b border-l px-2 text-right whitespace-nowrap text-muted-foreground tabular-nums 2xl:table-cell">{num(avg(groupYear))}</td>
                    <td className="sticky right-0 z-10 border-b border-l bg-card px-2 text-right whitespace-nowrap tabular-nums">{num(groupYear)}</td>
                  </tr>
                </GroupRows>
              );
            })}
            <tr className="h-11 font-semibold">
              <td className="sticky left-0 z-10 border-t-2 border-foreground/20 bg-card px-3" title="Income − expenses − savings">
                To be allocated
              </td>
              {months.map((m) => (
                <td
                  key={m}
                  className={cn("border-t-2 border-foreground/20 px-1 text-right whitespace-nowrap tabular-nums", allocated(m) < 0 ? "text-destructive" : "text-tone-income", m === currentMonth && "bg-primary/5")}
                >
                  {num(allocated(m))}
                </td>
              ))}
              <td className="hidden border-t-2 border-l border-foreground/20 px-2 text-right whitespace-nowrap text-muted-foreground tabular-nums 2xl:table-cell">
                {num(avg(yearTotal(allocated)))}
              </td>
              <td
                className={cn(
                  "sticky right-0 z-10 border-t-2 border-l border-foreground/20 bg-card px-2 text-right whitespace-nowrap tabular-nums",
                  yearTotal(allocated) < 0 ? "text-destructive" : "text-tone-income",
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
        {GROUPS.map(({ group, label, dot }) => (
          <section key={group} className="overflow-hidden rounded-xl border bg-card">
            <h3 className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm font-semibold">
              <span className={cn("size-2 rounded-full", dot)} />
              {label} <span className="ml-auto tabular-nums">{money(total(group, mobileMonth))}</span>
            </h3>
            <ul className="divide-y">
              {lines
                .filter((l) => l.group === group)
                .map((line) => (
                  <li key={line.key} className="flex items-center gap-2 px-3 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
                    <button type="button" onClick={() => sameEveryMonth(line)} aria-label={`Same every month for ${line.label}`} className="rounded p-1 text-muted-foreground hover:bg-muted">
                      <RepeatIcon className="size-4" />
                    </button>
                    <span className="w-32">{cell(line, mobileMonth, "h-9 text-base")}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <p className={cn("flex justify-between rounded-xl border-2 bg-card px-3 py-2 font-semibold", allocated(mobileMonth) < 0 ? "text-destructive" : "text-tone-income")}>
          To be allocated <span className="tabular-nums">{money(allocated(mobileMonth))}</span>
        </p>
      </div>
    </div>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
