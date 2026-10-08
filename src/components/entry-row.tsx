import Link from "next/link";
import { ArrowDownLeftIcon, ArrowLeftRightIcon, ArrowUpRightIcon, FlagIcon } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { EntryView } from "@/lib/ledger/describe";
import { cn } from "@/lib/utils";

const ICONS = {
  INCOME: ArrowDownLeftIcon,
  EXPENSE: ArrowUpRightIcon,
  TRANSFER: ArrowLeftRightIcon,
  OPENING_BALANCE: FlagIcon,
};

/** One transaction in a list. `amountOverride` shows its effect on a single account instead. */
export function EntryRow({
  entry,
  currency,
  amountOverride,
  trailing,
}: {
  entry: EntryView;
  currency: string;
  amountOverride?: number;
  trailing?: React.ReactNode;
}) {
  const Icon = ICONS[entry.kind];
  const title =
    entry.kind === "TRANSFER"
      ? `${entry.fromName} → ${entry.toName}`
      : entry.kind === "OPENING_BALANCE"
        ? "Opening balance"
        : entry.categoryName;
  const subtitle =
    entry.kind === "INCOME"
      ? `into ${entry.accountName}`
      : entry.kind === "EXPENSE"
        ? `from ${entry.accountName}`
        : entry.kind === "OPENING_BALANCE"
          ? entry.accountName
          : "Transfer";

  const shown = amountOverride ?? (entry.kind === "EXPENSE" ? -entry.amount : entry.amount);
  const tone =
    amountOverride !== undefined || entry.kind === "TRANSFER" || entry.kind === "OPENING_BALANCE"
      ? ""
      : entry.kind === "INCOME"
        ? "text-emerald-700 dark:text-emerald-400"
        : "";

  return (
    <Link href={`/history/${entry.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          entry.kind === "INCOME" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          entry.kind === "EXPENSE" && "bg-rose-500/10 text-rose-700 dark:text-rose-400",
          (entry.kind === "TRANSFER" || entry.kind === "OPENING_BALANCE") && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
          {entry.details && ` · ${entry.details}`}
        </span>
      </span>
      <span className="text-right">
        <span className={cn("block font-medium whitespace-nowrap tabular-nums", tone)}>
          {shown > 0 && entry.kind === "INCOME" && amountOverride === undefined ? "+" : ""}
          {formatMoney(shown, currency)}
        </span>
        {trailing}
      </span>
    </Link>
  );
}
