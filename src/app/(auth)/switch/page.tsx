import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRightIcon, UserPlusIcon } from "lucide-react";
import { getDeviceSessions } from "@/lib/auth/session";
import { AuthCard } from "../auth-card";

export const metadata = { title: "Choose account" };

export default async function SwitchPage() {
  const sessions = await getDeviceSessions();
  if (sessions.length === 0) redirect("/login");

  return (
    <AuthCard title="Who is using Pocket Ledger?" description="Accounts signed in on this device.">
      <ul className="grid gap-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/lock?s=${s.id}`}
              className="flex min-h-14 items-center gap-3 rounded-lg border px-3 transition-colors hover:bg-muted"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                {s.user.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 font-medium">{s.user.name}</span>
              <span className="text-xs text-muted-foreground">{s.user.pinHash ? "PIN" : "Password"}</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/login"
            className="flex min-h-14 items-center gap-3 rounded-lg border border-dashed px-3 text-muted-foreground transition-colors hover:bg-muted"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-muted">
              <UserPlusIcon className="size-4" />
            </span>
            <span className="flex-1 font-medium">Sign in to another account</span>
          </Link>
        </li>
      </ul>
    </AuthCard>
  );
}
