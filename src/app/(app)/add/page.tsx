import { PlusIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Add transaction" };

export default async function AddPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Add transaction" />
      <ComingSoon icon={PlusIcon} phase="Phase 1">
        Simple forms for income, expenses and transfers. You fill in the form, and the app records
        both sides of the entry for you.
      </ComingSoon>
    </>
  );
}
