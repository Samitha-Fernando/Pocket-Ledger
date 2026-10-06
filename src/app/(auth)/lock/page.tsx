import { redirect } from "next/navigation";
import { LockIcon } from "lucide-react";
import { MAX_FAILED_PINS } from "@/lib/auth/policy";
import { getCurrentSession, getDeviceSessionById } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { signOutAction, switchUserAction } from "../actions";
import { AuthCard } from "../auth-card";
import { UnlockForm } from "../forms";

export const metadata = { title: "Locked" };

export default async function LockPage({ searchParams }: PageProps<"/lock">) {
  const { s } = await searchParams;
  const sessionId = typeof s === "string" ? s : undefined;

  let session;
  if (sessionId) {
    session = await getDeviceSessionById(sessionId);
  } else {
    const current = await getCurrentSession();
    if (current.state === "active") redirect("/");
    session = current.state === "locked" ? current.session : null;
  }
  if (!session) redirect("/switch");

  const canUsePin = Boolean(session.user.pinHash) && session.pinFailedCount < MAX_FAILED_PINS;
  const initial = session.user.name.trim().charAt(0).toUpperCase();

  return (
    <AuthCard
      title={`Hi, ${session.user.name}`}
      description={canUsePin ? "Enter your PIN to unlock." : "Enter your password to unlock."}
    >
      <div className="grid gap-4">
        <div className="flex justify-center">
          <span className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
            {initial}
            <LockIcon className="absolute -right-1 -bottom-1 size-6 rounded-full bg-background p-1 text-muted-foreground" />
          </span>
        </div>
        <UnlockForm sessionId={sessionId} canUsePin={canUsePin} />
        <div className="grid grid-cols-2 gap-2">
          <form action={switchUserAction} className={sessionId ? "col-span-2" : undefined}>
            <Button type="submit" variant="outline" className="h-11 w-full">
              Switch user
            </Button>
          </form>
          {!sessionId && (
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="h-11 w-full">
                Sign out
              </Button>
            </form>
          )}
        </div>
      </div>
    </AuthCard>
  );
}
