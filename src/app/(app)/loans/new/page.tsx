import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";
import { NewLoanForm } from "../forms";

export const metadata = { title: "Lend or invest" };

export default async function NewLoanPage() {
  const { user, db } = await getLedger();
  const data = await getFormData(db, user.assetThresholdCents);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Lend or invest"
        description="The money moves from your account to the person or bank. Your net worth doesn't change; it's still yours, just somewhere else."
      />
      <Card>
        <CardContent>
          <NewLoanForm
            today={todayIso(user.timezone)}
            currency={user.currency}
            accounts={data.assets.filter((a) => !a.archived)}
            incomeCategories={data.incomeCategories.filter((c) => !c.archived)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
