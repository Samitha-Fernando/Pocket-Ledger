import Link from "next/link";
import { ChevronRightIcon, PackageIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney } from "@/lib/format";
import { getRawBalances } from "@/lib/ledger/accounts";
import { ASSET_CLASSES, STATUS_LABELS } from "@/lib/ledger/asset-classes";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const { user, db } = await getLedger();
  const [assets, balances] = await Promise.all([
    db.fixedAsset.findMany({ orderBy: [{ purchaseDate: "desc" }] }),
    getRawBalances(db),
  ]);
  const value = (accountId: string) => balances.get(accountId) ?? BigInt(0);
  const active = assets.filter((a) => a.status === "ACTIVE");
  const past = assets.filter((a) => a.status !== "ACTIVE");
  const totalValue = active.reduce((s, a) => s + value(a.accountId), BigInt(0));
  const totalCost = active.reduce((s, a) => s + a.cost, BigInt(0));
  const money = (v: bigint) => formatMoney(v, user.currency);

  const row = (a: (typeof assets)[number]) => (
    <Link key={a.id} href={`/assets/${a.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60">
      {a.photoPath ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
        <img src={`/api/assets/${a.id}/photo`} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
          <PackageIcon className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{a.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {ASSET_CLASSES[a.assetClass as keyof typeof ASSET_CLASSES]?.label ?? a.assetClass} · bought {formatIsoDate(a.purchaseDate)}
          {a.status !== "ACTIVE" && ` · ${STATUS_LABELS[a.status]}`}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-medium tabular-nums">{a.status === "ACTIVE" ? money(value(a.accountId)) : "—"}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">cost {money(a.cost)}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Assets" description="Things you own that keep their value, at what they're worth today." />
        <Button className="h-10 gap-1.5" render={<Link href="/assets/new" />} nativeButton={false}>
          <PlusIcon /> Buy asset
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Worth now</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(totalValue)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(totalCost)}</p>
        </div>
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
        <div className="grid gap-6">
          {active.length > 0 && <div className="divide-y overflow-hidden rounded-xl border bg-card">{active.map(row)}</div>}
          {past.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Sold or scrapped</h2>
              <div className="divide-y overflow-hidden rounded-xl border bg-card">{past.map(row)}</div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
