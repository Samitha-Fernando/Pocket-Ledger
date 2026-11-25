"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import type { DueBucket } from "@/lib/ledger/due-buckets";
import { cn } from "@/lib/utils";

/**
 * Small charts for the registers (Lending, Assets, Cards & loans). Each page draws in shades
 * of its own money colour (--tone-* in globals.css), mixed with the card colour so they work
 * in light and dark mode.
 */
export type ToneName = "money" | "savings" | "owe" | "lent" | "assets" | "income" | "expense";
const MIX = [100, 74, 54, 38, 26, 18];
export const shade = (tone: ToneName, i: number) => `color-mix(in oklab, var(--tone-${tone}) ${MIX[Math.min(i, MIX.length - 1)]}%, var(--color-card))`;

export type Slice = { label: string; value: number }; // value in cents

const tooltipStyle = {
  contentStyle: { background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" },
  itemStyle: { color: "var(--color-popover-foreground)" },
  labelStyle: { color: "var(--color-muted-foreground)" },
};

/** Keeps the biggest slices and folds the rest into "Other", so the donut stays readable. */
function topSlices(slices: Slice[], max = 5) {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const rest = sorted.slice(max - 1).reduce((s, x) => s + x.value, 0);
  return [...sorted.slice(0, max - 1), { label: "Other", value: rest }];
}

/** A donut with the total in the middle and a legend (amount + share) beside it. */
export function Donut({ slices, tone, currency, centerLabel }: { slices: Slice[]; tone: ToneName; currency: string; centerLabel: string }) {
  const data = topSlices(slices);
  const total = data.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-4 @sm:flex-row">
        <div className="relative size-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="70%"
                outerRadius="100%"
                paddingAngle={data.length > 1 ? 1.5 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((s, i) => (
                  <Cell key={s.label} fill={shade(tone, i)} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v, name) => [formatMoney(Number(v), currency), name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
            <span className="text-sm font-semibold tabular-nums">{compactMoney(total)}</span>
          </div>
        </div>
        <ul className="grid w-full min-w-0 flex-1 gap-1.5 text-sm">
          {data.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: shade(tone, i) }} />
              <span className="min-w-0 flex-1 truncate" title={s.label}>
                {s.label}
              </span>
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round((s.value / total) * 100)}%</span>
              <span className="shrink-0 text-right font-medium tabular-nums">{formatMoney(s.value, currency).replace(/\.00$/, "")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Horizontal bars, biggest first (e.g. money out with each person). */
export function BarList({ items, tone, currency, max = 6 }: { items: Slice[]; tone: ToneName; currency: string; max?: number }) {
  const sorted = [...items].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, max);
  const top = shown[0]?.value ?? 0;
  if (!top) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  return (
    <ul className="grid gap-2.5">
      {shown.map((s) => (
        <li key={s.label} className="grid gap-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate" title={s.label}>
              {s.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatMoney(s.value, currency).replace(/\.00$/, "")}</span>
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${(s.value / top) * 100}%`, background: shade(tone, 0) }} />
          </span>
        </li>
      ))}
      {sorted.length > max && <li className="text-xs text-muted-foreground">+ {sorted.length - max} more</li>}
    </ul>
  );
}

/** Amounts due week by week (overdue first, in red), e.g. money coming back or payments to make. */
export function DueChart({ buckets, tone, currency }: { buckets: DueBucket[]; tone: ToneName; currency: string }) {
  if (!buckets.some((b) => b.amount > 0)) return <p className="text-sm text-muted-foreground">Nothing due in the next 8 weeks.</p>;
  return (
    <div className="h-44 w-full" role="img" aria-label="Amounts due each week">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="var(--color-border)" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
          <YAxis stroke="var(--color-border)" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} tickLine={false} width={40} tickFormatter={compactMoney} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--color-muted)" }} formatter={(v) => [formatMoney(Number(v), currency), "Due"]} />
          <Bar dataKey="amount" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {buckets.map((b) => (
              <Cell key={b.label} fill={b.overdue ? "var(--color-destructive)" : shade(tone, 0)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A thin used-vs-limit bar (cards), turning red when nearly full. */
export function UsageBar({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const p = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-muted", className)} title={`${p.toFixed(0)}% of the limit used`}>
      <span className={cn("block h-full rounded-full", p >= 80 ? "bg-destructive" : "bg-tone-owe")} style={{ width: `${p}%` }} />
    </span>
  );
}

/** 12,345,600 cents → "123k"; 125,000,000 → "1.3M". */
export function compactMoney(cents: number) {
  const v = Math.abs(cents / 100);
  const sign = cents < 0 ? "-" : "";
  if (v >= 1_000_000) return `${sign}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${sign}${Math.round(v / 1_000)}k`;
  return `${sign}${Math.round(v)}`;
}
