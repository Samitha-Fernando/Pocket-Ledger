import { BriefcaseIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Registers" };

export default async function RegistersPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Registers" description="Assets you own, money you have lent or invested, and money you owe." />
      <ComingSoon icon={BriefcaseIcon} phase="Phases 2–4">
        Assets with depreciation (Phase 2), lending &amp; investments (Phase 3), and credit cards &amp;
        loans (Phase 4).
      </ComingSoon>
    </>
  );
}
