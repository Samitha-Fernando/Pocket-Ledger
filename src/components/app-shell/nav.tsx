"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRightIcon,
  HouseIcon,
  PlusIcon,
  SettingsIcon,
  WalletIcon,
  BriefcaseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: HouseIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/history", label: "History", icon: ArrowLeftRightIcon },
  { href: "/registers", label: "Registers", icon: BriefcaseIcon },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // Asset pages live under the Registers tab.
  if (href === "/registers" && ["/assets", "/loans", "/debts", "/budgets"].some((p) => pathname.startsWith(p))) return true;
  if (href === "/history" && pathname.startsWith("/import")) return true;
  return pathname.startsWith(href);
}

/** Desktop / tablet: left sidebar. */
export function SidebarNav() {
  const pathname = usePathname();
  const items = [...NAV, { href: "/settings", label: "Settings", icon: SettingsIcon }];
  return (
    <nav className="grid gap-1">
      <Link
        href="/add"
        className="mb-3 flex h-11 items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/85"
      >
        <PlusIcon className="size-5" /> Add transaction
      </Link>
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            "aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone: bottom tab bar with a raised "Add" button in the middle. */
export function BottomNav() {
  const pathname = usePathname();
  const [first, second, ...rest] = NAV;
  const tab = ({ href, label, icon: Icon }: (typeof NAV)[number]) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive(pathname, href) ? "page" : undefined}
      className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground aria-[current=page]:text-primary"
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="flex items-stretch">
        {tab(first)}
        {tab(second)}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/add"
            aria-label="Add transaction"
            className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95"
          >
            <PlusIcon className="size-7" />
          </Link>
        </div>
        {rest.map(tab)}
      </div>
    </nav>
  );
}
