import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { centsToInput } from "@/lib/format";
import type { DebtKind } from "@/lib/ledger/debt-kinds";
import { EditDebtForm } from "../../forms";

export const metadata = { title: "Edit card or loan" };

export default async function EditDebtPage({ params }: PageProps<"/debts/[id]/edit">) {
  const { db } = await getLedger();
  const { id } = await params;
  const debt = await db.debt.findUnique({ where: { id } });
  if (!debt) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/debts/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> {debt.name}
      </Link>
      <PageHeader title="Edit details" />
      <Card>
        <CardContent>
          <EditDebtForm
            debtId={debt.id}
            defaults={{
              name: debt.name,
              lender: debt.lender ?? "",
              kind: debt.kind as DebtKind,
              rate: debt.rateBasisPoints ? String(debt.rateBasisPoints / 100) : "",
              ratePeriod: debt.ratePeriod,
              creditLimit: debt.creditLimit ? centsToInput(Number(debt.creditLimit)) : "",
              dueDay: debt.dueDay ? String(debt.dueDay) : "",
              monthlyPayment: debt.monthlyPayment ? centsToInput(Number(debt.monthlyPayment)) : "",
              endDate: debt.endDate ?? "",
              notes: debt.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
