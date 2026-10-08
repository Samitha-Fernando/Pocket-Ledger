"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSET_CLASSES } from "@/lib/ledger/asset-classes";
import { currencySymbol } from "@/lib/format";
import { selectClass } from "@/components/entry-form";

export type AssetFieldDefaults = {
  name?: string;
  assetClass?: string;
  lifeYears?: number;
  residual?: string;
  notes?: string;
};

/** The extra questions for an asset: name, class, life, leftover value, notes, photo. */
export function AssetFields({
  defaults = {},
  currency,
  photoLabel = "Photo (optional)",
}: {
  defaults?: AssetFieldDefaults;
  currency: string;
  photoLabel?: string;
}) {
  const [assetClass, setAssetClass] = useState(defaults.assetClass ?? "ELECTRONICS");
  const [lifeYears, setLifeYears] = useState(
    String(defaults.lifeYears ?? ASSET_CLASSES[assetClass as keyof typeof ASSET_CLASSES].lifeMonths / 12),
  );
  const [lifeTouched, setLifeTouched] = useState(defaults.lifeYears !== undefined);

  return (
    <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="assetName">What is it?</Label>
        <Input id="assetName" name="assetName" defaultValue={defaults.name} placeholder="e.g. Honda Dio bike" maxLength={80} required className="h-11 text-base md:text-sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="assetClass">Asset class</Label>
          <select
            id="assetClass"
            name="assetClass"
            value={assetClass}
            onChange={(e) => {
              setAssetClass(e.target.value);
              // Fill in the usual life for the class, unless it was typed in by hand.
              if (!lifeTouched) setLifeYears(String(ASSET_CLASSES[e.target.value as keyof typeof ASSET_CLASSES].lifeMonths / 12));
            }}
            className={selectClass}
          >
            {Object.entries(ASSET_CLASSES).map(([key, c]) => (
              <option key={key} value={key}>
                {c.label} ({c.lifeMonths / 12} yrs)
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lifeYears">Useful life (years)</Label>
          <Input
            id="lifeYears"
            name="lifeYears"
            type="number"
            inputMode="decimal"
            min={0}
            max={50}
            step={0.5}
            value={lifeYears}
            onChange={(e) => {
              setLifeYears(e.target.value);
              setLifeTouched(true);
            }}
            required
            className="h-11 text-base md:text-sm"
          />
          <p className="text-xs text-muted-foreground">0 = doesn&apos;t lose value (e.g. gold, land).</p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="residualValue">Leftover value at the end ({currencySymbol(currency)}, optional)</Label>
        <Input id="residualValue" name="residualValue" inputMode="decimal" defaultValue={defaults.residual} placeholder="0.00" className="h-11 text-base md:text-sm" />
        <p className="text-xs text-muted-foreground">What you think it will still be worth when its useful life is over.</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" name="notes" defaultValue={defaults.notes} maxLength={1000} placeholder="e.g. Serial number, warranty until…" className="h-11 text-base md:text-sm" />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="photo">{photoLabel}</Label>
        <Input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="h-11 py-2 text-sm" />
        <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB. Only you can see it.</p>
      </div>
    </div>
  );
}
