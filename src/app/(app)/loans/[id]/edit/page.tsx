import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { getFormData } from "@/lib/ledger/form-data";
import type { LoanKind } from "@/lib/ledger/loan-kinds";
import { EditLoanForm } from "../../forms";

export const metadata = { title: "Edit loan" };

export default async function EditLoanPage({ params }: PageProps<"/loans/[id]/edit">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const loan = await db.loan.findUnique({ where: { id } });
  if (!loan) notFound();
  const data = await getFormData(db, user.assetThresholdCents);

  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/loans/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> {loan.counterparty}
      </Link>
      <PageHeader title="Edit loan details" />
      <Card>
        <CardContent>
          <EditLoanForm
            loanId={loan.id}
            startDate={loan.startDate}
            incomeCategories={data.incomeCategories.filter((c) => !c.archived || c.id === loan.interestAccountId)}
            defaults={{
              counterparty: loan.counterparty,
              kind: loan.kind as LoanKind,
              rate: loan.rateBasisPoints ? String(loan.rateBasisPoints / 100) : "",
              ratePeriod: loan.ratePeriod,
              dueDate: loan.dueDate ?? "",
              interestAccountId: loan.interestAccountId,
              notes: loan.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
