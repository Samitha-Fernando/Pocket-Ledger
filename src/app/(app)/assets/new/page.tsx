import { PageHeader } from "@/components/coming-soon";
import { EntryForm } from "@/components/entry-form";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";

export const metadata = { title: "Buy asset" };

export default async function BuyAssetPage() {
  const { user, db } = await getLedger();
  const data = await getFormData(db, user.assetThresholdCents);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Buy an asset"
        description="The money moves from your account into the asset, so your net worth doesn't drop. It then loses value a little each month."
      />
      <Card>
        <CardContent>
          <EntryForm data={data} today={todayIso(user.timezone)} currency={user.currency} assetOnly />
        </CardContent>
      </Card>
    </div>
  );
}
