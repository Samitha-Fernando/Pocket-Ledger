import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CoinsIcon,
  CreditCardIcon,
  HandCoinsIcon,
  LandmarkIcon,
  type LucideIcon,
  PackageIcon,
  PiggyBankIcon,
  PlusIcon,
  ScaleIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { PageHeader, WidePage } from "@/components/coming-soon";
import { StatTile, TONES, type Tone } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatMonth, formatMoney, shiftMonth, todayIso } from "@/lib/format";
import { ASSET_SUBTYPES, type AccountWithBalance, FIXED_SUBTYPE, LENT_SUBTYPE, getAccountsWithBalances, isMoneyAccount } from "@/lib/ledger/accounts";
import { monthEnd } from "@/lib/ledger/assets";
import { cn } from "@/lib/utils";

export const metadata = { title: "Accounts" };

const ZERO = BigInt(0);
const sum = (list: AccountWithBalance[]) => list.reduce((s, a) => s + a.balance, ZERO);

/** Icon for an account, by what kind it is. */
function iconFor(a: AccountWithBalance): LucideIcon {
  if (a.subtype === "CASH") return WalletIcon;
  if (a.subtype === "BANK") return LandmarkIcon;
  if (a.subtype === "SAVINGS") return PiggyBankIcon;
  if (a.subtype === "CARD") return CreditCardIcon;
  if (a.subtype === LENT_SUBTYPE) return HandCoinsIcon;
  if (a.subtype === FIXED_SUBTYPE) return PackageIcon;
  if (a.type === "LIABILITY") return ScaleIcon;
  return CoinsIcon;
}

function SectionTitle({
  title,
  total,
  tone,
  icon: Icon,
  currency,
  extra,
}: {
  title: string;
  total: bigint;
  tone: Tone;
  icon: LucideIcon;
  currency: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <span className={cn("flex size-7 items-center justify-center rounded-lg", TONES[tone].chip)}>
        <Icon className="size-4" />
      </span>
      <h2 className="font-semibold">{title}</h2>
      {extra}
      <p className={cn("ml-auto font-semibold tabular-nums", TONES[tone].text)}>{formatMoney(total, currency)}</p>
    </div>
  );
}

/** Accounts as coloured cards in a grid that adds columns as the screen grows. */
function CardGroup({
  title,
  icon,
  tone,
  accounts,
  currency,
  subtitle,
}: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  accounts: AccountWithBalance[];
  currency: string;
  subtitle?: (a: AccountWithBalance) => string | undefined;
}) {
  return (
    <section>
      <SectionTitle title={title} total={sum(accounts)} tone={tone} icon={icon} currency={currency} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {accounts.map((a) => {
          const Icon = iconFor(a);
          return (
            <Link
              key={a.id}
              href={`/accounts/${a.id}`}
              className={cn("flex min-h-18 min-w-0 items-center gap-3 rounded-xl border border-l-4 bg-card px-3 py-2.5 shadow-xs transition-colors hover:bg-muted/50", TONES[tone].edge)}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone].chip)}>
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-medium break-words" title={a.name}>
                  {a.name}
                </span>
                {subtitle?.(a) && <span className="block text-xs text-muted-foreground">{subtitle(a)}</span>}
              </span>
              <span className={cn("shrink-0 font-semibold tabular-nums", a.balance < ZERO && "text-destructive")}>{formatMoney(a.balance, currency)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Income or expense categories for a month, biggest first, with a bar for each one's share. */
function CategoryList({
  title,
  icon,
  tone,
  accounts,
  currency,
  showAll,
}: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  accounts: AccountWithBalance[];
  currency: string;
  showAll: boolean;
}) {
  const total = sum(accounts);
  const sorted = [...accounts].sort((a, b) => Number(b.balance - a.balance));
  const shown = showAll ? sorted : sorted.filter((a) => a.balance !== ZERO);
  return (
    <section className="min-w-0">
      <SectionTitle title={title} total={total} tone={tone} icon={icon} currency={currency} />
      <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {shown.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nothing this month.</p>}
        {shown.map((a) => {
          const share = total > ZERO && a.balance > ZERO ? Number((a.balance * BigInt(1000)) / total) / 10 : 0;
          return (
            <Link key={a.id} href={`/accounts/${a.id}`} className="grid gap-1 px-3 py-2 transition-colors hover:bg-muted/50">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className={cn("truncate", a.balance === ZERO ? "text-muted-foreground" : "font-medium")} title={a.name}>
                  {a.name}
                </span>
                <span className={cn("shrink-0 tabular-nums", a.balance === ZERO && "text-muted-foreground")}>
                  {formatMoney(a.balance, currency)}
                  {share > 0 && <span className="ml-2 inline-block w-11 text-right text-xs text-muted-foreground">{share.toFixed(0)}%</span>}
                </span>
              </span>
              {share > 0 && (
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", TONES[tone].bar)} style={{ width: `${share}%` }} />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const { user, db } = await getLedger();
  const params = await searchParams;
  const thisMonth = todayIso(user.timezone).slice(0, 7);
  const asked = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked;
  const showAll = params.all === "1";
  const [allTime, inMonth] = await Promise.all([getAccountsWithBalances(db), getAccountsWithBalances(db, { from: `${month}-01`, to: monthEnd(month) })]);

  const active = allTime.filter((a) => !a.archived && !a.isSystem);
  const money = active.filter((a) => isMoneyAccount(a));
  // Fixed assets still owned (sold ones are worth 0 and live on the Assets page).
  const fixed = active.filter((a) => a.subtype === FIXED_SUBTYPE && a.balance !== ZERO);
  // Money lent out that hasn't come back yet.
  const lent = active.filter((a) => a.subtype === LENT_SUBTYPE && a.balance !== ZERO);
  // Cards and loans you owe (cards are listed even at zero).
  const owe = active.filter((a) => a.type === "LIABILITY" && (a.subtype === "CARD" || a.balance !== ZERO));
  const income = inMonth.filter((a) => a.type === "INCOME" && !a.archived);
  const expenses = inMonth.filter((a) => a.type === "EXPENSE" && !a.archived);
  const archived = allTime.filter((a) => a.archived && a.subtype !== FIXED_SUBTYPE && a.subtype !== LENT_SUBTYPE);
  const netWorth = sum(money) + sum(lent) + sum(fixed) - sum(owe);
  const hidden = [...income, ...expenses].filter((a) => a.balance === ZERO).length;

  const link = (p: { month?: string; all?: boolean }) => {
    const q = new URLSearchParams();
    const m = p.month ?? month;
    if (m !== thisMonth) q.set("month", m);
    if (p.all ?? showAll) q.set("all", "1");
    const s = q.toString();
    return `/accounts${s ? `?${s}` : ""}`;
  };
  const cur = user.currency;

  return (
    <>
      <WidePage />
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Accounts" description="Balances are always calculated from your transactions." />
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/accounts/new" />} nativeButton={false}>
          <PlusIcon /> Add
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Your money" icon={WalletIcon} tone="money" value={formatMoney(sum(money), cur)} sub={`${money.length} account${money.length === 1 ? "" : "s"}`} />
        <StatTile label="Lent out & invested" icon={HandCoinsIcon} tone="lent" value={formatMoney(sum(lent), cur)} href="/loans" sub={`${lent.length} open`} />
        <StatTile label="Fixed assets" icon={PackageIcon} tone="assets" value={formatMoney(sum(fixed), cur)} href="/assets" sub="worth now" />
        <StatTile label="You owe" icon={CreditCardIcon} tone="owe" value={formatMoney(sum(owe), cur)} href="/debts" sub="cards & loans" />
        <StatTile className="col-span-2 md:col-span-1" label="Net worth" icon={ScaleIcon} value={formatMoney(netWorth, cur)} sub="own − owe" valueClassName={netWorth < ZERO ? "text-destructive" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-7">
        <CardGroup title="Your money" icon={WalletIcon} tone="money" accounts={money} currency={cur} subtitle={(a) => ASSET_SUBTYPES[a.subtype as keyof typeof ASSET_SUBTYPES]} />
        {owe.length > 0 && (
          <CardGroup title="Money you owe" icon={CreditCardIcon} tone="owe" accounts={owe} currency={cur} subtitle={(a) => (a.subtype === "CARD" ? "Credit card" : "Loan")} />
        )}
        {lent.length > 0 && <CardGroup title="Lent out & invested" icon={HandCoinsIcon} tone="lent" accounts={lent} currency={cur} />}
        {fixed.length > 0 && <CardGroup title="Fixed assets (worth now)" icon={PackageIcon} tone="assets" accounts={fixed} currency={cur} />}

        {/* Income and expenses for a month */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <h2 className="mr-auto text-lg font-semibold">Income & expenses</h2>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-lg" aria-label="Previous month" render={<Link href={link({ month: shiftMonth(month, -1) })} />} nativeButton={false}>
                <ChevronLeftIcon />
              </Button>
              <span className="w-36 text-center text-sm font-medium">{formatMonth(month)}</span>
              <Button
                variant="outline"
                size="icon-lg"
                aria-label="Next month"
                disabled={month >= thisMonth}
                render={month >= thisMonth ? undefined : <Link href={link({ month: shiftMonth(month, 1) })} />}
                nativeButton={month >= thisMonth}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            {(hidden > 0 || showAll) && (
              <Link href={link({ all: !showAll })} className="flex h-9 items-center rounded-full border px-3 text-sm text-muted-foreground hover:bg-muted">
                {showAll ? "Hide empty categories" : `Show ${hidden} empty`}
              </Link>
            )}
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <CategoryList title="Income" icon={TrendingUpIcon} tone="income" accounts={income} currency={cur} showAll={showAll} />
            <CategoryList title="Expenses" icon={TrendingDownIcon} tone="expense" accounts={expenses} currency={cur} showAll={showAll} />
          </div>
        </section>

        {archived.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer px-1 text-sm text-muted-foreground select-none">Archived ({archived.length})</summary>
            <div className="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
              {archived.map((a) => (
                <Link key={a.id} href={`/accounts/${a.id}`} className="flex min-h-12 items-center justify-between px-3 text-muted-foreground hover:bg-muted/60">
                  <span>{a.name}</span>
                  <span className="tabular-nums">{formatMoney(a.balance, cur)}</span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  );
}
