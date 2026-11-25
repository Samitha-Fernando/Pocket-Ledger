import Link from "next/link";
import { ChevronRightIcon, PackageIcon, PlusIcon, ReceiptTextIcon, TrendingDownIcon } from "lucide-react";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { Donut } from "@/components/register-charts";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney } from "@/lib/format";
import { getRawBalances } from "@/lib/ledger/accounts";
import { ASSET_CLASSES, STATUS_LABELS } from "@/lib/ledger/asset-classes";

export const metadata = { title: "Assets" };

const ZERO = BigInt(0);

export default async function AssetsPage() {
  const { user, db } = await getLedger();
  const [assets, balances] = await Promise.all([
    db.fixedAsset.findMany({ orderBy: [{ purchaseDate: "desc" }] }),
    getRawBalances(db),
  ]);
  const value = (accountId: string) => balances.get(accountId) ?? ZERO;
  const active = assets.filter((a) => a.status === "ACTIVE");
  const past = assets.filter((a) => a.status !== "ACTIVE");
  const totalValue = active.reduce((s, a) => s + value(a.accountId), ZERO);
  const totalCost = active.reduce((s, a) => s + a.cost, ZERO);
  const lost = totalCost - totalValue;
  const lostPct = totalCost > ZERO ? Number((lost * BigInt(1000)) / totalCost) / 10 : 0;
  const money = (v: bigint) => formatMoney(v, user.currency);
  const classLabel = (c: string) => ASSET_CLASSES[c as keyof typeof ASSET_CLASSES]?.label ?? c;

  const byClass = new Map<string, number>();
  for (const a of active) byClass.set(classLabel(a.assetClass), (byClass.get(classLabel(a.assetClass)) ?? 0) + Number(value(a.accountId)));

  const row = (a: (typeof assets)[number]) => {
    const worth = value(a.accountId);
    const kept = a.status === "ACTIVE" && a.cost > ZERO ? Math.max(0, Math.min(100, Number((worth * BigInt(1000)) / a.cost) / 10)) : 0;
    return (
      <Link key={a.id} href={`/assets/${a.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
        {a.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
          <img src={`/api/assets/${a.id}/photo`} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tone-assets/12 text-tone-assets">
            <PackageIcon className="size-4.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{a.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {classLabel(a.assetClass)} · bought {formatIsoDate(a.purchaseDate)}
            {a.status !== "ACTIVE" && ` · ${STATUS_LABELS[a.status]}`}
          </span>
          {a.status === "ACTIVE" && (
            <span className="mt-1.5 flex items-center gap-2" title={`Worth ${kept.toFixed(0)}% of what you paid`}>
              <span className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-tone-assets" style={{ width: `${kept}%` }} />
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{kept.toFixed(0)}% of cost</span>
            </span>
          )}
        </span>
        <span className="text-right">
          <span className="block font-medium tabular-nums">{a.status === "ACTIVE" ? money(worth) : "—"}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">cost {money(a.cost)}</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  };

  return (
    <>
      <WidePage />
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Assets" description="Things you own that keep their value, at what they're worth today." />
        <Button className="h-10 gap-1.5" render={<Link href="/assets/new" />} nativeButton={false}>
          <PlusIcon /> Buy asset
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Worth now" icon={PackageIcon} tone="assets" value={money(totalValue)} sub={`${active.length} asset${active.length === 1 ? "" : "s"}`} />
        <StatTile label="Paid" icon={ReceiptTextIcon} value={money(totalCost)} sub="what they cost" />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label="Value lost so far"
          icon={TrendingDownIcon}
          tone="expense"
          value={money(lost)}
          sub={`${lostPct.toFixed(1)}% of what you paid (depreciation)`}
        />
      </div>

      {assets.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <PackageIcon className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No assets yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            When you buy something that lasts (a bike, phone or laptop), record it as an asset. Purchases of{" "}
            {money(BigInt(user.assetThresholdCents))} or more are suggested automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {active.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By class</CardTitle>
                <CardDescription>Worth now</CardDescription>
              </CardHeader>
              <CardContent>
                <Donut slices={[...byClass].map(([label, v]) => ({ label, value: v }))} tone="assets" currency={user.currency} centerLabel="Worth now" />
              </CardContent>
            </Card>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-span-2">
            {active.length > 0 && <div className="divide-y overflow-hidden rounded-xl border bg-card">{active.map(row)}</div>}
            {past.length > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Sold or scrapped</h2>
                <div className="divide-y overflow-hidden rounded-xl border bg-card">{past.map(row)}</div>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
