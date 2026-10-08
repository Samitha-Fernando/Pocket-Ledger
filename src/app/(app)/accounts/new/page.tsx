import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { NewAccountForm } from "../forms";

export const metadata = { title: "Add account" };

export default async function NewAccountPage() {
  const { user } = await getLedger();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Add account or category" />
      <Card>
        <CardContent>
          <NewAccountForm today={todayIso(user.timezone)} />
        </CardContent>
      </Card>
    </div>
  );
}
