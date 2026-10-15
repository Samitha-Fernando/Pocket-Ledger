import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";
import { NewDebtForm } from "../forms";

export const metadata = { title: "Add card or loan" };

export default async function NewDebtPage() {
  const { user, db } = await getLedger();
  const data = await getFormData(db, user.assetThresholdCents);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Add a card or loan" description="Credit cards can then be chosen under “Paid from” when you add an expense." />
      <Card>
        <CardContent>
          <NewDebtForm
            today={todayIso(user.timezone)}
            accounts={data.assets.filter((a) => !a.archived)}
            expenseCategories={data.expenseCategories.filter((c) => !c.archived)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
