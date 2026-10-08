"use client";

import { useActionState, useState } from "react";
import { AssetFields } from "@/components/asset-fields";
import { selectClass } from "@/components/entry-form";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Option } from "@/lib/ledger/form-data";
import { convertToExpenseAction, revalueAction, sellAction, updateAssetAction } from "./actions";

export function RevalueForm({ assetId, today }: { assetId: string; today: string }) {
  const [state, action] = useActionState(revalueAction, undefined);
  return (
    <form action={action} className="grid gap-3" key={state?.success}>
      <input type="hidden" name="assetId" value={assetId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="It's now worth" name="value" inputMode="decimal" placeholder="0.00" required />
        <Field label="As of" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      <Field label="Why? (optional)" name="details" placeholder="e.g. Cracked screen" maxLength={200} />
      <FormMessage state={state} />
      <SubmitButton variant="outline">Update value</SubmitButton>
    </form>
  );
}

export function SellForm({ assetId, today, accounts }: { assetId: string; today: string; accounts: Option[] }) {
  const [state, action] = useActionState(sellAction, undefined);
  const [status, setStatus] = useState<"SOLD" | "DISPOSED">("SOLD");
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="assetId" value={assetId} />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="What happened">
        {(
          [
            ["SOLD", "Sold it"],
            ["DISPOSED", "Scrapped / gave away"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-medium text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm"
          >
            <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {status === "SOLD" && <Field label="Sold for" name="price" inputMode="decimal" placeholder="0.00" required />}
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      {status === "SOLD" && (
        <div className="grid gap-1.5">
          <Label htmlFor="sell-account">Money went into</Label>
          <select id="sell-account" name="accountId" className={selectClass} required defaultValue={accounts[0]?.id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Depreciation stops at this date. The difference between its value and what you got is recorded as
        &ldquo;Gain on assets&rdquo; or &ldquo;Loss on assets&rdquo;.
      </p>
      <FormMessage state={state} />
      <SubmitButton variant="outline">{status === "SOLD" ? "Record sale" : "Record as scrapped"}</SubmitButton>
    </form>
  );
}

export function ConvertToExpenseForm({ assetId, categories }: { assetId: string; categories: Option[] }) {
  const [state, action] = useActionState(convertToExpenseAction, undefined);
  return (
    <form
      action={action}
      className="grid gap-3"
      onSubmit={(e) => {
        if (!window.confirm("Turn this asset back into a normal expense? Its depreciation and value changes will be removed.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="assetId" value={assetId} />
      <div className="grid gap-1.5">
        <Label htmlFor="convert-category">Expense category</Label>
        <select id="convert-category" name="categoryId" className={selectClass} required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" className="text-destructive">
        Convert to expense
      </SubmitButton>
    </form>
  );
}

export function EditAssetForm({
  asset,
  accounts,
  locked,
  currency,
}: {
  asset: {
    id: string;
    name: string;
    assetClass: string;
    purchaseDate: string;
    cost: string;
    residual: string;
    lifeYears: number;
    notes: string;
    fundingAccountId: string;
    hasPhoto: boolean;
  };
  accounts: Option[];
  /** Sold/scrapped: money fields can't change until the sale is undone. */
  locked: boolean;
  currency: string;
}) {
  const [state, action] = useActionState(updateAssetAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="assetId" value={asset.id} />
      <div className={cn("grid gap-4 sm:grid-cols-2", locked && "pointer-events-none opacity-60")}>
        <Field label="Price paid" name="amount" inputMode="decimal" defaultValue={asset.cost} required readOnly={locked} />
        <Field label="Purchase date" name="date" type="date" defaultValue={asset.purchaseDate} required readOnly={locked} />
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="edit-funding">Paid from</Label>
          <select id="edit-funding" name="accountId" className={selectClass} defaultValue={asset.fundingAccountId} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {locked && <p className="text-xs text-muted-foreground">Undo the sale to change the price, date or life.</p>}
      <AssetFields
        currency={currency}
        photoLabel={asset.hasPhoto ? "Replace photo (optional)" : "Photo (optional)"}
        defaults={{ name: asset.name, assetClass: asset.assetClass, lifeYears: asset.lifeYears, residual: asset.residual, notes: asset.notes }}
      />
      <p className="text-xs text-muted-foreground">Changing the price, date, life or leftover value re-calculates all its depreciation.</p>
      <FormMessage state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
