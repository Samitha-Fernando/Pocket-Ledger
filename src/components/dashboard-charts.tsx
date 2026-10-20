"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";

// Colours come from the theme, so charts follow light / dark mode.
const C = {
  primary: "var(--color-primary)",
  income: "var(--chart-income)",
  expenses: "var(--chart-expense)",
  moved: "var(--chart-moved)",
  grid: "var(--color-border)",
  text: "var(--color-muted-foreground)",
};

/** 12,345,600 cents → "Rs 123k"; 125,000,000 → "Rs 1.3M". */
function compact(cents: number) {
  const rupees = cents / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

const axis = { stroke: C.grid, tick: { fill: C.text, fontSize: 11 }, tickLine: false };
const tooltipStyle = {
  contentStyle: { background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" },
  labelStyle: { color: "var(--color-muted-foreground)" },
};

export type MonthPoint = { label: string; netWorth: number; income: number; expenses: number; kept: number | null; moved: number | null };

export function NetWorthChart({ data, currency }: { data: MonthPoint[]; currency: string }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Net worth at the end of each month for the last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={C.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={44} tickFormatter={compact} />
          <Tooltip {...tooltipStyle} formatter={(v) => [formatMoney(Number(v), currency), "Net worth"]} />
          <Area type="monotone" dataKey="netWorth" stroke={C.primary} strokeWidth={2} fill="url(#nw)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IncomeExpenseChart({ data, currency }: { data: MonthPoint[]; currency: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Income and expenses for each of the last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={44} tickFormatter={compact} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--color-muted)" }} formatter={(v, name) => [formatMoney(Number(v), currency), name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill={C.income} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill={C.expenses} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SavingsRateChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="h-40 w-full" role="img" aria-label="Savings rate for each of the last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={40} tickFormatter={(v) => `${v}%`} />
          <Tooltip {...tooltipStyle} formatter={(v, name) => [v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`, name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="kept" name="Kept" stroke={C.primary} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="moved" name="Moved to savings" stroke={C.moved} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
