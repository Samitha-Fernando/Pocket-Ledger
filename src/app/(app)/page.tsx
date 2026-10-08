import Link from "next/link";
import { ChartLineIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMonth, formatMoney, todayIso } from "@/lib/format";
import { FIXED_SUBTYPE, getAccountsWithBalances, isMoneyAccount } from "@/lib/ledger/accounts";
import { cn } from "@/lib/utils";

export const metadata = { title: "Home" };

function Tile({ label, value, note, href, muted }: { label: string; value: string; note?: string; href?: string; muted?: boolean }) {
  const body = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", muted && "text-muted-foreground/60")}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </>
  );
  const className = "rounded-xl border bg-card p-4";
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:bg-muted/60")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default async function HomePage() {
  const { user, db } = await getLedger();
  const today = todayIso(user.timezone);
  const month = today.slice(0, 7);
  const [accounts, monthly] = await Promise.all([
    getAccountsWithBalances(db),
    getAccountsWithBalances(db, { from: `${month}-01`, to: `${month}-31` }),
  ]);

  const total = (filter: (a: (typeof accounts)[number]) => boolean, list = accounts) =>
    list.filter(filter).reduce((s, a) => s + a.balance, BigInt(0));
  const cashBank = total((a) => isMoneyAccount(a) && a.subtype !== "SAVINGS");
  const savings = total((a) => a.type === "ASSET" && a.subtype === "SAVINGS");
  const fixedAssets = total((a) => a.subtype === FIXED_SUBTYPE);
  const netWorth = total((a) => a.type === "ASSET") - total((a) => a.type === "LIABILITY");
  const income = total((a) => a.type === "INCOME", monthly);
  // Includes depreciation: a real (non-cash) expense.
  const expenses = total((a) => a.type === "EXPENSE", monthly);
  const money = (v: bigint) => formatMoney(v, user.currency);

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} description={`Today is ${formatIsoDate(today)}`} />

      <div className="mb-6 rounded-2xl bg-primary p-5 text-primary-foreground">
        <p className="text-sm opacity-80">Net worth</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{money(netWorth)}</p>
        <p className="mt-1 text-xs opacity-80">What you own minus what you owe</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="Cash & bank" value={money(cashBank)} href="/accounts" />
        <Tile label="Savings" value={money(savings)} href="/accounts" />
        <Tile label={`Income · ${formatMonth(month).split(" ")[0]}`} value={money(income)} href="/history" />
        <Tile label={`Expenses · ${formatMonth(month).split(" ")[0]}`} value={money(expenses)} href="/history" />
        <Tile label="Lent out" value={money(BigInt(0))} note="Phase 3" muted />
        <Tile label="Fixed assets" value={money(fixedAssets)} note="worth today" href="/assets" />
        <Tile label="Debts" value={money(BigInt(0))} note="Phase 4" muted />
      </div>

      <ComingSoon icon={ChartLineIcon} phase="Phase 6">
        Net-worth trend, income vs expenses by month, savings rate, top spending categories and what is due soon.
      </ComingSoon>
    </>
  );
}
