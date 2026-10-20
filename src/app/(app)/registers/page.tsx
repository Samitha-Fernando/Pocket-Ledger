import Link from "next/link";
import { ChevronRightIcon, CreditCardIcon, HandCoinsIcon, PackageIcon, PiggyBankIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { getLedger } from "@/lib/auth/session";
import { formatMoney, todayIso } from "@/lib/format";
import { getLoans } from "@/lib/ledger/loans";
import { getDebts } from "@/lib/ledger/debts";
import { getRawBalances } from "@/lib/ledger/accounts";
import { cn } from "@/lib/utils";

export const metadata = { title: "Registers" };

export default async function RegistersPage() {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const [assets, balances, loans, debts] = await Promise.all([
    db.fixedAsset.findMany({ where: { status: "ACTIVE" }, select: { accountId: true } }),
    getRawBalances(db),
    getLoans(db, today),
    getDebts(db, today),
  ]);
  const activeDebts = debts.filter((d) => d.debt.status === "ACTIVE");
  const owed = activeDebts.reduce((s, d) => s + d.owed, BigInt(0));
  const attention = activeDebts.filter((d) => d.overdue || d.dueSoon).length;
  const active = loans.filter((l) => l.loan.status === "ACTIVE");
  const out = active.reduce((s, l) => s + l.out, BigInt(0));
  const overdue = active.filter((l) => l.overdue).length;
  const assetValue = assets.reduce((s, a) => s + (balances.get(a.accountId) ?? BigInt(0)), BigInt(0));

  const registers = [
    {
      href: "/budgets",
      icon: PiggyBankIcon,
      title: "Budgets",
      text: "Plan each month and compare with what you actually spent",
      ready: true,
    },
    {
      href: "/assets",
      icon: PackageIcon,
      title: "Assets",
      text: `${assets.length} owned · worth ${formatMoney(assetValue, user.currency)}`,
      ready: true,
    },
    {
      href: "/loans",
      icon: HandCoinsIcon,
      title: "Lending & investments",
      text: `${active.length} active · ${formatMoney(out, user.currency)} out${overdue ? ` · ${overdue} overdue` : ""}`,
      ready: true,
    },
    {
      href: "/debts",
      icon: CreditCardIcon,
      title: "Credit cards & loans",
      text: `${activeDebts.length} active · ${formatMoney(owed, user.currency)} owed${attention ? ` · ${attention} payment${attention === 1 ? "" : "s"} due` : ""}`,
      ready: true,
    },
  ];

  return (
    <>
      <PageHeader title="Registers" description="Your budget, assets you own, money you have lent or invested, and money you owe." />
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
