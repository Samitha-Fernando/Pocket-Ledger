import { PageHeader } from "@/components/coming-soon";
import { EntryForm } from "@/components/entry-form";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { todayIso } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";

export const metadata = { title: "Add transaction" };

const KINDS = { expense: "EXPENSE", income: "INCOME", transfer: "TRANSFER" } as const;

export default async function AddPage({ searchParams }: PageProps<"/add">) {
  const { user, db } = await getLedger();
  const { type } = await searchParams;
  const data = await getFormData(db);
  const initialKind = KINDS[(typeof type === "string" ? type : "expense") as keyof typeof KINDS] ?? "EXPENSE";

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Add transaction" />
      <Card>
        <CardContent>
          <EntryForm data={data} today={todayIso(user.timezone)} currency={user.currency} initialKind={initialKind} />
        </CardContent>
      </Card>
    </div>
  );
}
