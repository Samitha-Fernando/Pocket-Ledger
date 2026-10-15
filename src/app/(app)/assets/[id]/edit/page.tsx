import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { centsToInput } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";
import { EditAssetForm } from "../../forms";

export const metadata = { title: "Edit asset" };

export default async function EditAssetPage({ params }: PageProps<"/assets/[id]/edit">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const asset = await db.fixedAsset.findUnique({ where: { id } });
  if (!asset) notFound();
  const purchase = await db.entry.findFirst({ where: { assetId: id, kind: "ASSET_PURCHASE" }, include: { lines: true } });
  const fundingAccountId = purchase?.lines.find((l) => l.accountId !== asset.accountId)?.accountId ?? "";
  const data = await getFormData(db, user.assetThresholdCents);
  const accounts = data.payFrom.filter((a) => !a.archived || a.id === fundingAccountId);

  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/assets/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> {asset.name}
      </Link>
      <PageHeader title="Edit asset" />
      <Card>
        <CardContent>
          <EditAssetForm
            currency={user.currency}
            accounts={accounts}
            locked={asset.status !== "ACTIVE"}
            asset={{
              id: asset.id,
              name: asset.name,
              assetClass: asset.assetClass,
              purchaseDate: asset.purchaseDate,
              cost: centsToInput(Number(asset.cost)),
              residual: asset.residualValue > BigInt(0) ? centsToInput(Number(asset.residualValue)) : "",
              lifeYears: asset.usefulLifeMonths / 12,
              notes: asset.notes ?? "",
              fundingAccountId,
              hasPhoto: Boolean(asset.photoPath),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
