import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { AuthCard } from "../auth-card";
import { SetupForm } from "../forms";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <AuthCard
      title="Welcome to Pocket Ledger"
      description="First-time setup. This creates the admin account. After this, new people can only join with an invite code from you."
    >
      <SetupForm />
    </AuthCard>
  );
}
