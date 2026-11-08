import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Colour families for kinds of money, used across Home, Accounts and Budgets so each
 * kind always looks the same. Literal class names so Tailwind keeps them.
 */
export const TONES = {
  money: {
    chip: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    bar: "bg-teal-500",
    text: "text-teal-700 dark:text-teal-300",
    soft: "bg-teal-500/8",
    edge: "border-l-teal-500",
  },
  owe: {
    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    bar: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    soft: "bg-rose-500/8",
    edge: "border-l-rose-500",
  },
  lent: {
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    bar: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
    soft: "bg-violet-500/8",
    edge: "border-l-violet-500",
  },
  assets: {
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    soft: "bg-amber-500/8",
    edge: "border-l-amber-500",
  },
  income: {
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "bg-emerald-500/8",
    edge: "border-l-emerald-500",
  },
  expense: {
    chip: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
    bar: "bg-pink-500",
    text: "text-pink-700 dark:text-pink-300",
    soft: "bg-pink-500/8",
    edge: "border-l-pink-500",
  },
  savings: {
    chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    soft: "bg-sky-500/8",
    edge: "border-l-sky-500",
  },
  neutral: {
    chip: "bg-primary/15 text-primary",
    bar: "bg-primary",
    text: "text-foreground",
    soft: "bg-muted/50",
    edge: "border-l-primary",
  },
} as const;
export type Tone = keyof typeof TONES;

/** A headline number with a coloured icon, e.g. "Net worth Rs 1,176,815". */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  href,
  valueClassName,
  className: extra,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
  valueClassName?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", TONES[tone].chip)}>
          <Icon className="size-4" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("mt-2 block truncate text-lg font-semibold tracking-tight tabular-nums sm:text-xl 2xl:text-2xl", valueClassName)} title={value}>
        {value}
      </span>
      {sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const className = cn("block min-w-0 rounded-xl border bg-card p-3.5 shadow-xs", extra);
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:bg-muted/50")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
