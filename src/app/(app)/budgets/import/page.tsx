import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { BudgetUploadForm } from "./forms";

export const metadata = { title: "Import budgets" };

export default async function BudgetImportPage() {
  await getLedger();
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/budgets" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Budgets
      </Link>
      <PageHeader title="Import budgets from Excel" />
      <Card>
        <CardHeader>
          <CardTitle>Upload your spreadsheet</CardTitle>
          <CardDescription>
            Reads the “Budget Planning” sheet (every year block with numbers). You&apos;ll see each line and choose where it goes before anything is saved.
            The file isn&apos;t kept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetUploadForm />
        </CardContent>
      </Card>
    </div>
  );
}
