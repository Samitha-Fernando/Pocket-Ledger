import Link from "next/link";
import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  FlagIcon,
  HandCoinsIcon,
  PackageIcon,
  TrendingDownIcon,
  WrenchIcon,
} from "lucide-react";
import type { EntryKind } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/format";
import type { EntryView } from "@/lib/ledger/describe";
import { cn } from "@/lib/utils";

const ICONS: Record<EntryKind, typeof FlagIcon> = {
  INCOME: ArrowDownLeftIcon,
  EXPENSE: ArrowUpRightIcon,
  TRANSFER: ArrowLeftRightIcon,
  OPENING_BALANCE: FlagIcon,
  ASSET_PURCHASE: PackageIcon,
  DEPRECIATION: TrendingDownIcon,
  ASSET_REVALUATION: TrendingDownIcon,
  ASSET_SALE: HandCoinsIcon,
};

function titleAndSubtitle(e: EntryView): [string | undefined, string | undefined] {
  switch (e.kind) {
    case "TRANSFER":
      return [`${e.fromName} → ${e.toName}`, "Transfer"];
    case "OPENING_BALANCE":
      return ["Opening balance", e.accountName];
    case "INCOME":
      return [e.categoryName, `into ${e.accountName}`];
    case "EXPENSE":
      return [e.categoryName, `from ${e.accountName}${e.assetName ? ` · for ${e.assetName}` : ""}`];
    case "ASSET_PURCHASE":
      return [`Bought ${e.assetName}`, `from ${e.accountName}`];
    case "DEPRECIATION":
      return ["Depreciation", e.assetName];
    case "ASSET_REVALUATION":
      return ["Value change", e.assetName];
    case "ASSET_SALE":
      return [`Sold / scrapped ${e.assetName ?? ""}`.trim(), e.accountName ? `into ${e.accountName}` : "No money received"];
  }
}

/** What the row shows as the amount (sign included), when not overridden. */
function shownAmount(e: EntryView) {
  if (e.kind === "EXPENSE" || e.kind === "DEPRECIATION") return -e.amount;
  return e.amount;
}

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
  const Icon = entry.kind === "EXPENSE" && entry.assetId ? WrenchIcon : ICONS[entry.kind];
  const [title, subtitle] = titleAndSubtitle(entry);
  const shown = amountOverride ?? shownAmount(entry);
  const isIncome = entry.kind === "INCOME" && amountOverride === undefined;
  const isSpend = entry.kind === "EXPENSE" || entry.kind === "DEPRECIATION";

  return (
    <Link href={`/history/${entry.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
          entry.kind === "INCOME" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          isSpend && "bg-rose-500/10 text-rose-700 dark:text-rose-400",
          (entry.kind === "ASSET_PURCHASE" || entry.kind === "ASSET_SALE") && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
          {entry.details && entry.details !== entry.assetName && ` · ${entry.details}`}
        </span>
      </span>
      <span className="text-right">
        <span className={cn("block font-medium whitespace-nowrap tabular-nums", isIncome && "text-emerald-700 dark:text-emerald-400")}>
          {isIncome && shown > 0 ? "+" : ""}
          {formatMoney(shown, currency)}
        </span>
        {trailing}
      </span>
    </Link>
  );
}
