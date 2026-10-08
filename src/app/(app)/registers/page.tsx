import Link from "next/link";
import { ChevronRightIcon, CreditCardIcon, HandCoinsIcon, PackageIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { getLedger } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { getRawBalances } from "@/lib/ledger/accounts";
import { cn } from "@/lib/utils";

export const metadata = { title: "Registers" };

export default async function RegistersPage() {
  const { user, db } = await getLedger();
  const [assets, balances] = await Promise.all([
    db.fixedAsset.findMany({ where: { status: "ACTIVE" }, select: { accountId: true } }),
    getRawBalances(db),
  ]);
  const assetValue = assets.reduce((s, a) => s + (balances.get(a.accountId) ?? BigInt(0)), BigInt(0));

  const registers = [
    {
      href: "/assets",
      icon: PackageIcon,
      title: "Assets",
      text: `${assets.length} owned · worth ${formatMoney(assetValue, user.currency)}`,
      ready: true,
    },
    { href: "", icon: HandCoinsIcon, title: "Lending & investments", text: "Coming in Phase 3", ready: false },
    { href: "", icon: CreditCardIcon, title: "Credit cards & loans", text: "Coming in Phase 4", ready: false },
  ];

  return (
    <>
      <PageHeader title="Registers" description="Assets you own, money you have lent or invested, and money you owe." />
      <div className="grid gap-3">
        {registers.map(({ href, icon: Icon, title, text, ready }) => {
          const body = (
            <>
              <span className={cn("flex size-11 items-center justify-center rounded-xl", ready ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-muted-foreground">{text}</span>
              </span>
              {ready && <ChevronRightIcon className="size-4 text-muted-foreground" />}
            </>
          );
          const className = "flex min-h-20 items-center gap-4 rounded-xl border bg-card px-4";
          return ready ? (
            <Link key={title} href={href} className={cn(className, "transition-colors hover:bg-muted/60")}>
              {body}
            </Link>
          ) : (
            <div key={title} className={cn(className, "opacity-70")}>
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}
