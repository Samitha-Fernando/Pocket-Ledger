import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatMonth, formatMoney, todayIso } from "@/lib/format";
import { ASSET_SUBTYPES, type AccountWithBalance, getAccountsWithBalances } from "@/lib/ledger/accounts";

export const metadata = { title: "Accounts" };

function Group({
  title,
  total,
  accounts,
  currency,
  subtitle,
}: {
  title: string;
  total: bigint;
  accounts: AccountWithBalance[];
  currency: string;
  subtitle?: (a: AccountWithBalance) => string | undefined;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <p className="text-sm font-semibold tabular-nums">{formatMoney(total, currency)}</p>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {accounts.map((a) => (
          <Link key={a.id} href={`/accounts/${a.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{a.name}</span>
              {subtitle?.(a) && <span className="block text-xs text-muted-foreground">{subtitle(a)}</span>}
            </span>
            <span className={`tabular-nums ${a.balance < BigInt(0) ? "text-destructive" : ""}`}>{formatMoney(a.balance, currency)}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}

const sum = (list: AccountWithBalance[]) => list.reduce((s, a) => s + a.balance, BigInt(0));

export default async function AccountsPage() {
  const { user, db } = await getLedger();
  const month = todayIso(user.timezone).slice(0, 7);
  const [allTime, thisMonth] = await Promise.all([
    getAccountsWithBalances(db),
    getAccountsWithBalances(db, { from: `${month}-01`, to: `${month}-31` }),
  ]);

  const active = allTime.filter((a) => !a.archived && !a.isSystem);
  const assets = active.filter((a) => a.type === "ASSET");
  const income = thisMonth.filter((a) => a.type === "INCOME" && !a.archived);
  const expenses = thisMonth.filter((a) => a.type === "EXPENSE" && !a.archived);
  const archived = allTime.filter((a) => a.archived);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Accounts" description="Balances are always calculated from your transactions." />
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/accounts/new" />} nativeButton={false}>
          <PlusIcon /> Add
        </Button>
      </div>

      <div className="grid gap-6">
        <Group
          title="Your money"
          total={sum(assets)}
          accounts={assets}
          currency={user.currency}
          subtitle={(a) => ASSET_SUBTYPES[a.subtype as keyof typeof ASSET_SUBTYPES]}
        />
        <Group title={`Income · ${formatMonth(month)}`} total={sum(income)} accounts={income} currency={user.currency} />
        <Group title={`Expenses · ${formatMonth(month)}`} total={sum(expenses)} accounts={expenses} currency={user.currency} />

        {archived.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer px-1 text-sm text-muted-foreground select-none">
              Archived ({archived.length})
            </summary>
            <div className="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
              {archived.map((a) => (
                <Link key={a.id} href={`/accounts/${a.id}`} className="flex min-h-12 items-center justify-between px-3 text-muted-foreground hover:bg-muted/60">
                  <span>{a.name}</span>
                  <span className="tabular-nums">{formatMoney(a.balance, user.currency)}</span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  );
}
