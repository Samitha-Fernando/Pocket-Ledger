import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, PencilIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMonth, formatMoney, todayIso } from "@/lib/format";
import { ASSET_CLASSES, STATUS_LABELS } from "@/lib/ledger/asset-classes";
import { getAssetDetails } from "@/lib/ledger/assets";
import { describeEntry } from "@/lib/ledger/describe";
import { getFormData } from "@/lib/ledger/form-data";
import { cn } from "@/lib/utils";
import { deleteRevaluationAction, removePhotoAction, undoSaleAction } from "../actions";
import { ConvertToExpenseForm, RevalueForm, SellForm } from "../forms";

export const metadata = { title: "Asset" };

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", strong && "text-lg")}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default async function AssetPage({ params }: PageProps<"/assets/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const details = await getAssetDetails(db, id);
  if (!details) notFound();
  const { asset } = details;
  const today = todayIso(user.timezone);
  const formData = await getFormData(db, user.assetThresholdCents);
  const money = (v: bigint | number) => formatMoney(v, user.currency);
  const active = asset.status === "ACTIVE";
  const lifeYears = asset.usefulLifeMonths / 12;
  const past = details.schedule.filter((s) => !s.projected);
  const future = details.schedule.filter((s) => s.projected);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/assets" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Assets
      </Link>

      <div className="mb-5 flex gap-4">
        {asset.photoPath && (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
          <img src={`/api/assets/${asset.id}/photo`} alt={asset.name} className="size-24 shrink-0 rounded-xl border object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            {ASSET_CLASSES[asset.assetClass as keyof typeof ASSET_CLASSES]?.label} · {STATUS_LABELS[asset.status]}
            {asset.disposedDate && ` on ${formatIsoDate(asset.disposedDate)}`}
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{asset.name}</h1>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{active ? money(details.value) : money(0)}</p>
          <p className="text-xs text-muted-foreground">{active ? "Worth today (book value)" : "No longer owned"}</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Price paid" value={money(asset.cost)} note={`on ${formatIsoDate(asset.purchaseDate)}`} />
        <Stat label="Depreciation so far" value={money(details.depreciationTotal)} note={active && details.monthlyNow > BigInt(0) ? `${money(details.monthlyNow)} / month now` : undefined} />
        <Stat label="Repairs & upkeep" value={money(details.repairsTotal)} note={`${details.repairs.length} linked`} />
        {details.sale && <Stat label="Sold for" value={money(details.sale.proceeds)} note={formatIsoDate(details.sale.date)} />}
        <Stat
          label="True cost of owning it"
          value={money(details.trueCost)}
          note={active ? "price + repairs − worth now" : "price + repairs − sold for"}
          strong
        />
        <Stat
          label="Useful life"
          value={asset.usefulLifeMonths === 0 ? "Doesn't lose value" : `${lifeYears} year${lifeYears === 1 ? "" : "s"}`}
          note={asset.residualValue > BigInt(0) ? `ends at ${money(asset.residualValue)}` : undefined}
        />
      </div>

      {asset.notes && <p className="mb-6 rounded-xl border bg-card p-3 text-sm">{asset.notes}</p>}

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href={`/assets/${asset.id}/edit`} />} nativeButton={false}>
          <PencilIcon /> Edit details
        </Button>
        {asset.photoPath && (
          <form action={removePhotoAction}>
            <input type="hidden" name="assetId" value={asset.id} />
            <Button type="submit" variant="ghost" className="h-10 gap-1.5 text-muted-foreground">
              <Trash2Icon /> Remove photo
            </Button>
          </form>
        )}
        {!active && (
          <form action={undoSaleAction}>
            <input type="hidden" name="assetId" value={asset.id} />
            <Button type="submit" variant="outline" className="h-10 gap-1.5">
              <UndoIcon /> Undo sale
            </Button>
          </form>
        )}
      </div>

      {details.repairs.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Repairs &amp; upkeep</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {details.repairs.map((e) => (
              <EntryRow
                key={e.id}
                entry={describeEntry(e)}
                currency={user.currency}
                trailing={<span className="block text-xs text-muted-foreground">{formatIsoDate(e.date)}</span>}
              />
            ))}
          </div>
        </section>
      )}

      {details.revaluations.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Value changes</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {details.revaluations.map((r) => (
              <div key={r.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.details ?? "Value change"}</span>
                  <span className="block text-xs text-muted-foreground">{formatIsoDate(r.date)}</span>
                </span>
                <span className={cn("tabular-nums", r.amount < BigInt(0) ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {r.amount > BigInt(0) ? "+" : ""}
                  {money(r.amount)}
                </span>
                {active && (
                  <form action={deleteRevaluationAction}>
                    <input type="hidden" name="entryId" value={r.id} />
                    <Button type="submit" variant="ghost" size="icon" aria-label="Remove this value change">
                      <Trash2Icon />
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {details.schedule.length > 0 && (
        <section className="mb-6">
          <details open={past.length <= 12}>
            <summary className="mb-1.5 cursor-pointer px-1 text-sm font-medium text-muted-foreground select-none">
              Depreciation schedule ({past.length} posted{future.length > 0 && `, ${future.length} to come`})
            </summary>
            <div className="max-h-96 overflow-auto rounded-xl border bg-card">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Month</th>
                    <th className="px-3 py-2 text-right font-medium">Value lost</th>
                    <th className="px-3 py-2 text-right font-medium">Worth after</th>
                  </tr>
                </thead>
                <tbody>
                  {details.schedule.map((s) => (
                    <tr key={s.month} className={cn("border-b last:border-0", s.projected && "text-muted-foreground")}>
                      <td className="px-3 py-1.5">
                        {formatMonth(s.month)}
                        {s.projected && <span className="ml-1.5 text-xs">(planned)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">{money(s.amount)}</td>
                      <td className="px-3 py-1.5 text-right">{money(s.valueAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {active && (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Change its value</CardTitle>
              <CardDescription>
                E.g. after damage. The difference is recorded as a gain or loss, and later months spread the new value over the life that&apos;s left.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RevalueForm assetId={asset.id} today={today} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sold or scrapped it?</CardTitle>
            </CardHeader>
            <CardContent>
              <SellForm assetId={asset.id} today={today} accounts={formData.assets.filter((a) => !a.archived)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Not really an asset?</CardTitle>
              <CardDescription>Turn it back into a normal expense on its purchase date. Linked repairs stay as expenses.</CardDescription>
            </CardHeader>
            <CardContent>
              <ConvertToExpenseForm assetId={asset.id} categories={formData.expenseCategories.filter((c) => !c.archived)} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
