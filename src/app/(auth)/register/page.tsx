import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { AuthCard } from "../auth-card";
import { RegisterForm } from "../forms";

export const metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  if ((await prisma.user.count()) === 0) redirect("/setup");
  const { code } = await searchParams;

  return (
    <AuthCard title="Create your account" description="Pocket Ledger is invite-only. Enter the code the admin gave you.">
      <div className="grid gap-4">
        <RegisterForm code={typeof code === "string" ? code : ""} />
        <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Already have an account? Sign in
        </Link>
      </div>
    </AuthCard>
  );
}
