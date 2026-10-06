import { WalletIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Accounts" description="Cash, bank, savings, cards and loans, with live balances." />
      <ComingSoon icon={WalletIcon} phase="Phase 1">
        Your chart of accounts and balances, always calculated from your transactions.
      </ComingSoon>
    </>
  );
}
