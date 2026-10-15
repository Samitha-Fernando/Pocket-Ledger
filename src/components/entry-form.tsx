"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowDownUpIcon, PackageIcon, TriangleAlertIcon } from "lucide-react";
import { AssetFields } from "@/components/asset-fields";
import { Switch } from "@/components/ui/switch";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveEntryAction } from "@/app/(app)/entries/actions";
import { centsToInput, currencySymbol, formatMoney, parseMoneyToCents } from "@/lib/format";
import type { EntryView } from "@/lib/ledger/describe";
import type { LedgerFormData, Option } from "@/lib/ledger/form-data";
import { cn } from "@/lib/utils";

type Kind = "EXPENSE" | "INCOME" | "TRANSFER" | "OPENING_BALANCE";

const TABS: { kind: Kind; label: string }[] = [
  { kind: "EXPENSE", label: "Expense" },
  { kind: "INCOME", label: "Income" },
  { kind: "TRANSFER", label: "Transfer" },
];

const SAVE_LABELS: Record<Kind, string> = {
  EXPENSE: "Save expense",
  INCOME: "Save income",
  TRANSFER: "Save transfer",
  OPENING_BALANCE: "Save opening balance",
};

export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

/** Only active options, plus the currently-selected one even if archived. */
function visible(options: Option[], selectedId?: string) {
  return options.filter((o) => !o.archived || o.id === selectedId);
}

function AccountSelect({
  label,
  name,
  options,
  value,
  onChange,
  currency,
}: {
  label: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  currency: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass} required>
        <option value="" disabled>
          Choose…
        </option>
        {visible(options, value).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.isCard ? `card, owes ${formatMoney(o.balance, currency)}` : formatMoney(o.balance, currency)}
          </option>
        ))}
      </select>
    </div>
  );
}

function CategoryPicker({ options, value, onChange }: { options: Option[]; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Category</legend>
      <div className="flex flex-wrap gap-2">
        {visible(options, value).map((o) => (
          <label
            key={o.id}
            className={cn(
              "flex min-h-10 cursor-pointer items-center rounded-full border px-3.5 text-sm transition-colors select-none hover:bg-muted",
              "has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            )}
          >
            <input type="radio" name="categoryId" value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" required />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function EntryForm({
  data,
  today,
  currency,
  entry,
  initialKind = "EXPENSE",
  assetOnly = false,
}: {
  data: LedgerFormData;
  today: string;
  currency: string;
  entry?: EntryView;
  initialKind?: Kind;
  /** The "Buy asset" page: always records an asset. */
  assetOnly?: boolean;
}) {
  const [state, action] = useActionState(saveEntryAction, undefined);
  const editing = Boolean(entry);
  const [kind, setKind] = useState<Kind>((entry?.kind as Kind | undefined) ?? (assetOnly ? "EXPENSE" : initialKind));
  // null = decide automatically from the amount (new purchases only).
  const [recordAsAsset, setRecordAsAsset] = useState<boolean | null>(assetOnly ? true : editing ? false : null);
  const [linkedAssetId, setLinkedAssetId] = useState(entry?.kind === "EXPENSE" ? entry.assetId ?? "" : "");
  const [linkedLoanId, setLinkedLoanId] = useState(entry?.kind === "INCOME" ? entry.loanId ?? "" : "");

  const [amount, setAmount] = useState(entry ? centsToInput(entry.amount) : "");
  const [date, setDate] = useState(entry?.date ?? today);
  const [details, setDetails] = useState(entry?.details ?? "");
  const [expenseCat, setExpenseCat] = useState(entry?.kind === "EXPENSE" ? entry.categoryId ?? "" : "");
  const [incomeCat, setIncomeCat] = useState(entry?.kind === "INCOME" ? entry.categoryId ?? "" : "");
  const first = data.assets.find((a) => !a.archived)?.id ?? "";
  const payOptions = data.payFrom;
  const [payFrom, setPayFrom] = useState(
    (entry?.kind === "EXPENSE" ? entry.accountId : data.defaults.expenseAccountId) ?? first,
  );
  const [receiveInto, setReceiveInto] = useState(
    (entry?.kind === "INCOME" ? entry.accountId : data.defaults.incomeAccountId) ?? first,
  );
  const [fromId, setFromId] = useState((entry?.kind === "TRANSFER" ? entry.fromId : data.defaults.transferFromId) ?? first);
  const [toId, setToId] = useState(
    (entry?.kind === "TRANSFER" ? entry.toId : data.defaults.transferToId) ??
      data.assets.find((a) => !a.archived && a.id !== first)?.id ??
      "",
  );
  const openingAccountId = entry?.kind === "OPENING_BALANCE" ? entry.accountId ?? "" : "";

  // After a successful save, clear the amount and details for the next one.
  const [lastSaved, setLastSaved] = useState(state?.savedAt);
  if (state?.savedAt !== lastSaved) {
    setLastSaved(state?.savedAt);
    setAmount("");
    setDetails("");
  }

  // Warn (don't block) when an account would go below zero.
  const cents = parseMoneyToCents(amount) ?? 0;

  // Asset vs expense is your choice; big purchases default to "asset".
  const overThreshold = cents >= data.assetThreshold;
  const isAsset = kind === "EXPENSE" && (recordAsAsset ?? overThreshold);
  const submitKind = isAsset ? "ASSET_PURCHASE" : kind;
  const payingId = kind === "EXPENSE" ? payFrom : kind === "TRANSFER" ? fromId : "";
  const paying = payOptions.find((a) => a.id === payingId);
  const alreadyCounted = entry && (entry.accountId === payingId || entry.fromId === payingId) ? entry.amount : 0;
  // Cash/bank: what's in it. Card: credit still available (if a limit is set).
  const available = !paying ? 0 : paying.isCard ? (paying.available ?? Infinity) + alreadyCounted : paying.balance + alreadyCounted;
  const overdraw = paying && cents > 0 && cents > available;

  return (
    <form action={action} className="grid gap-5">
      {entry && <input type="hidden" name="entryId" value={entry.id} />}
      {/* Editing an expense with the switch on converts it into an asset. */}
      {entry && isAsset && <input type="hidden" name="fromEntryId" value={entry.id} />}
      <input type="hidden" name="kind" value={submitKind} />

      {kind !== "OPENING_BALANCE" && !assetOnly && (
        <div role="tablist" aria-label="Transaction type" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => setKind(t.kind)}
              className="h-10 rounded-lg text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="amount">Amount</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted-foreground">
            {currencySymbol(currency)}
          </span>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const parsed = parseMoneyToCents(amount);
              if (parsed !== null) setAmount(formatMoney(parsed, currency).replace(/^-?\S+ /, parsed < 0 ? "-" : ""));
            }}
            className="h-14 pl-12 text-2xl font-semibold tabular-nums md:text-2xl"
            required
            autoFocus={!editing}
          />
        </div>
        {overdraw && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="size-3.5" />
            {paying.isCard
              ? `This is more than the ${formatMoney(Math.max(0, available), currency)} credit left on ${paying.name}.`
              : available > 0
                ? `This is more than the ${formatMoney(available, currency)} in ${paying.name}.`
                : `${paying.name} is already at ${formatMoney(available, currency)}.`}{" "}
            You can still save it.
          </p>
        )}
        {kind === "OPENING_BALANCE" && (
          <p className="text-xs text-muted-foreground">Use a minus sign for an overdrawn account, e.g. -5,000.</p>
        )}
      </div>

      {kind === "EXPENSE" && !assetOnly && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2">
          <PackageIcon className="size-5 text-muted-foreground" />
          <span className="flex-1">
            <span className="block text-sm font-medium">Record as asset?</span>
            <span className="block text-xs text-muted-foreground">
              {isAsset
                ? overThreshold && recordAsAsset === null
                  ? `Switched on because it's ${formatMoney(data.assetThreshold, currency)} or more. You can switch it off.`
                  : "It keeps its value and loses a little each month (depreciation)."
                : "For things that last, like a bike, phone or laptop."}
            </span>
          </span>
          <Switch checked={isAsset} onCheckedChange={(on: boolean) => setRecordAsAsset(on)} aria-label="Record as asset" />
        </label>
      )}

      {kind === "EXPENSE" && isAsset && (
        <AssetFields currency={currency} defaults={{ name: entry?.details ?? undefined }} />
      )}

      {kind === "EXPENSE" && (
        <>
          {!isAsset && <CategoryPicker options={data.expenseCategories} value={expenseCat} onChange={setExpenseCat} />}
          <AccountSelect label="Paid from" name="accountId" options={payOptions} value={payFrom} onChange={setPayFrom} currency={currency} />
          {!isAsset && data.fixedAssets.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="linkedAssetId">For an asset? (optional)</Label>
              <select id="linkedAssetId" name="linkedAssetId" value={linkedAssetId} onChange={(e) => setLinkedAssetId(e.target.value)} className={selectClass}>
                <option value="">Not linked</option>
                {data.fixedAssets
                  .filter((a) => a.active || a.id === linkedAssetId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">Link repairs and servicing to see the true cost of owning it.</p>
            </div>
          )}
        </>
      )}
      {kind === "INCOME" && (
        <>
          <CategoryPicker options={data.incomeCategories} value={incomeCat} onChange={setIncomeCat} />
          <AccountSelect label="Received into" name="accountId" options={data.assets} value={receiveInto} onChange={setReceiveInto} currency={currency} />
          {data.loans.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="linkedLoanId">From a loan or investment? (optional)</Label>
              <select id="linkedLoanId" name="linkedLoanId" value={linkedLoanId} onChange={(e) => setLinkedLoanId(e.target.value)} className={selectClass}>
                <option value="">Not linked</option>
                {data.loans
                  .filter((l) => l.active || l.id === linkedLoanId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">Link interest to the loan or deposit it came from to see its return.</p>
            </div>
          )}
        </>
      )}
      {kind === "TRANSFER" && (
        <div className="grid gap-2">
          <AccountSelect label="From" name="fromId" options={data.assets} value={fromId} onChange={setFromId} currency={currency} />
          <button
            type="button"
            onClick={() => {
              setFromId(toId);
              setToId(fromId);
            }}
            className="mx-auto flex h-9 items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:bg-muted"
          >
            <ArrowDownUpIcon className="size-4" /> Swap
          </button>
          <AccountSelect label="To" name="toId" options={data.assets} value={toId} onChange={setToId} currency={currency} />
          <p className="text-xs text-muted-foreground">
            Moving money between your own accounts (e.g. saving money) isn&apos;t an expense, so it doesn&apos;t change your net worth.
          </p>
        </div>
      )}
      {kind === "OPENING_BALANCE" && (
        <p className="text-sm">
          <input type="hidden" name="accountId" value={openingAccountId} />
          Starting balance of <strong>{entry?.accountName}</strong>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-base md:text-sm" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="details">Details (optional)</Label>
          <Input
            id="details"
            name="details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={500}
            placeholder={kind === "EXPENSE" ? "e.g. Weekly groceries" : ""}
            className="h-11 text-base md:text-sm"
          />
        </div>
      </div>

      <FormMessage state={state} />
      {state?.success && (
        <Link href="/history" className="-mt-2 text-sm text-primary underline-offset-4 hover:underline">
          View history
        </Link>
      )}
      <SubmitButton>{isAsset ? (editing ? "Convert to asset" : "Save asset") : editing ? "Save changes" : SAVE_LABELS[kind]}</SubmitButton>
    </form>
  );
}
