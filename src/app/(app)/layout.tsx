import Link from "next/link";
import { LockIcon, LogOutIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { DemoBanner } from "@/components/demo-banner";
import { BottomNav, SidebarNav } from "@/components/app-shell/nav";
import { IdleLock } from "@/components/app-shell/idle-lock";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { lockAction, signOutAction, switchUserAction } from "../(auth)/actions";

// Pages here depend on who is signed in, so never pre-render them.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh">
      <IdleLock minutes={user.autoLockMinutes} />

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <Link href="/" className="mb-6 px-1">
          <Brand />
        </Link>
        <SidebarNav />
        <div className="mt-auto grid gap-1 border-t pt-4">
          <p className="truncate px-3 pb-2 text-sm font-medium">{user.name}</p>
          <form action={switchUserAction}>
            <Button type="submit" variant="ghost" className="h-10 w-full justify-start gap-3 px-3 text-muted-foreground">
              <UsersIcon /> Switch user
            </Button>
          </form>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" className="h-10 w-full justify-start gap-3 px-3 text-muted-foreground">
              <LogOutIcon /> Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:px-6">
          <Link href="/" className="md:hidden">
            <Brand />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Settings"
              className="md:hidden"
              render={<Link href="/settings" />}
              nativeButton={false}
            >
              <SettingsIcon />
            </Button>
            <form action={lockAction}>
              <Button type="submit" variant="outline" className="h-9 gap-2">
                <LockIcon /> Lock
              </Button>
            </form>
          </div>
        </header>

        {/* Reading width by default; pages with <WidePage /> grow with the screen. */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 has-[[data-wide-page]]:max-w-[1680px] md:px-6 md:pb-10 xl:px-8">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
