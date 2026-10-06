import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getCurrentSession, getDeviceSessions } from "@/lib/auth/session";
import { AuthCard } from "../auth-card";
import { LoginForm } from "../forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if ((await prisma.user.count()) === 0) redirect("/setup");
  if ((await getCurrentSession()).state === "active") redirect("/");
  const saved = await getDeviceSessions();

  return (
    <AuthCard title="Sign in" description="Use your email or username and password.">
      <div className="grid gap-4">
        <LoginForm />
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          {saved.length > 0 && (
            <Link href="/switch" className="font-medium text-primary underline-offset-4 hover:underline">
              Choose a saved account on this device
            </Link>
          )}
          <Link href="/register" className="underline-offset-4 hover:underline">
            Have an invite code? Create an account
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}
