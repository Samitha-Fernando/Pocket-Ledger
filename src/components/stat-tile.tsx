import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Colour families for kinds of money, used across the app so each kind always looks the
 * same. The colours are theme tokens (--tone-* in globals.css, tuned for light and dark).
 * Literal class names so Tailwind keeps them.
 */
export const TONES = {
  money: { chip: "bg-tone-money/12 text-tone-money", bar: "bg-tone-money", text: "text-tone-money", soft: "bg-tone-money/6", edge: "border-l-tone-money" },
  owe: { chip: "bg-tone-owe/12 text-tone-owe", bar: "bg-tone-owe", text: "text-tone-owe", soft: "bg-tone-owe/6", edge: "border-l-tone-owe" },
  lent: { chip: "bg-tone-lent/12 text-tone-lent", bar: "bg-tone-lent", text: "text-tone-lent", soft: "bg-tone-lent/6", edge: "border-l-tone-lent" },
  assets: { chip: "bg-tone-assets/12 text-tone-assets", bar: "bg-tone-assets", text: "text-tone-assets", soft: "bg-tone-assets/6", edge: "border-l-tone-assets" },
  income: { chip: "bg-tone-income/12 text-tone-income", bar: "bg-tone-income", text: "text-tone-income", soft: "bg-tone-income/6", edge: "border-l-tone-income" },
  expense: { chip: "bg-tone-expense/12 text-tone-expense", bar: "bg-tone-expense", text: "text-tone-expense", soft: "bg-tone-expense/6", edge: "border-l-tone-expense" },
  savings: { chip: "bg-tone-savings/12 text-tone-savings", bar: "bg-tone-savings", text: "text-tone-savings", soft: "bg-tone-savings/6", edge: "border-l-tone-savings" },
  neutral: { chip: "bg-primary/12 text-primary", bar: "bg-primary", text: "text-foreground", soft: "bg-muted/50", edge: "border-l-primary" },
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
