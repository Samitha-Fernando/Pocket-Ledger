import { ArrowLeftRightIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "History" };

export default async function HistoryPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="History" description="Every transaction, searchable and editable." />
      <ComingSoon icon={ArrowLeftRightIcon} phase="Phase 1 & 5">
        A simple list arrives in Phase 1. The full workbench (filters, bulk edit, rules and Excel
        import) arrives in Phase 5.
      </ComingSoon>
    </>
  );
}
