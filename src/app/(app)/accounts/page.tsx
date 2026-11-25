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
import { TONES, type Tone } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMonth, formatMoney, shiftMonth, todayIso } from "@/lib/format";
import { ASSET_SUBTYPES, type AccountWithBalance, FIXED_SUBTYPE, LENT_SUBTYPE, getAccountsWithBalances, isMoneyAccount } from "@/lib/ledger/accounts";
import { ASSET_CLASSES } from "@/lib/ledger/asset-classes";
import { monthEnd } from "@/lib/ledger/assets";
import { DEBT_KINDS } from "@/lib/ledger/debt-kinds";
import { LOAN_KINDS } from "@/lib/ledger/loan-kinds";
import { cn } from "@/lib/utils";

export const metadata = { title: "Accounts" };

const ZERO = BigInt(0);
const sum = (list: { balance: bigint }[]) => list.reduce((s, a) => s + a.balance, ZERO);
const pct = (part: bigint, whole: bigint) => (whole > ZERO && part > ZERO ? Number((part * BigInt(1000)) / whole) / 10 : 0);

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

type Row = { id: string; href: string; name: string; detail?: string; balance: bigint; icon: LucideIcon; children?: Row[] };

/** One compact line: icon, full name + detail, share of the section, amount. */
function Line({ row, tone, total, currency, nested }: { row: Row; tone: Tone; total: bigint; currency: string; nested?: boolean }) {
  const share = pct(row.balance, total);
  return (
    <>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", nested ? "bg-transparent text-muted-foreground" : TONES[tone].chip)}>
        <row.icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block leading-tight break-words", nested ? "text-sm" : "font-medium")}>{row.name}</span>
        {row.detail && <span className="block text-xs leading-tight text-muted-foreground">{row.detail}</span>}
      </span>
      <span className="hidden w-28 shrink-0 items-center gap-2 sm:flex" title={`${share.toFixed(1)}% of this group`}>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", TONES[tone].bar, nested && "opacity-60")} style={{ width: `${share}%` }} />
        </span>
        <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">{share >= 1 ? share.toFixed(0) : share > 0 ? "<1" : "0"}%</span>
      </span>
      <span className={cn("shrink-0 text-right tabular-nums sm:w-32", nested ? "text-sm" : "font-semibold", row.balance < ZERO && "text-destructive")}>{formatMoney(row.balance, currency)}</span>
    </>
  );
}

/** A group of accounts as a compact table (rows with children fold open). */
function Section({ title, icon: Icon, tone, rows, currency, empty }: { title: string; icon: LucideIcon; tone: Tone; rows: Row[]; currency: string; empty?: string }) {
  const total = sum(rows);
  const rowClass = "flex min-h-12 items-center gap-3 px-3 py-1.5 transition-colors hover:bg-muted/50";
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className={cn("flex items-center gap-2.5 border-b border-l-[3px] px-3 py-2.5", TONES[tone].edge)}>
        <Icon className={cn("size-4", TONES[tone].text)} />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
        <span className={cn("ml-auto font-semibold tabular-nums", TONES[tone].text)}>{formatMoney(total, currency)}</span>
      </header>
      {rows.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">{empty ?? "None."}</p>}
      <ul className="divide-y">
        {rows.map((row) =>
          row.children && row.children.length > 1 ? (
            <li key={row.id}>
              <details className="group">
                <summary className={cn(rowClass, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                  <Line row={row} tone={tone} total={total} currency={currency} />
                  <ChevronRightIcon className="-ml-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <ul className="divide-y border-t bg-muted/30">
                  {row.children.map((c) => (
                    <li key={c.id}>
                      <Link href={c.href} className={cn(rowClass, "min-h-10 pl-8")}>
                        <Line row={c} tone={tone} total={total} currency={currency} nested />
                        <span className="w-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ) : (
            <li key={row.id}>
              <Link href={row.href} className={rowClass}>
                <Line row={row} tone={tone} total={total} currency={currency} />
                <span className="w-3" />
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/** Income or expense categories for a month, biggest first, with a bar for each one's share. */
function CategoryList({ title, icon, tone, accounts, currency, showAll }: { title: string; icon: LucideIcon; tone: Tone; accounts: AccountWithBalance[]; currency: string; showAll: boolean }) {
  const sorted = [...accounts].sort((a, b) => Number(b.balance - a.balance));
  const rows: Row[] = (showAll ? sorted : sorted.filter((a) => a.balance !== ZERO)).map((a) => ({ id: a.id, href: `/accounts/${a.id}`, name: a.name, balance: a.balance, icon }));
  return <Section title={title} icon={icon} tone={tone} rows={rows} currency={currency} empty="Nothing this month." />;
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const { user, db } = await getLedger();
  const params = await searchParams;
  const thisMonth = todayIso(user.timezone).slice(0, 7);
  const asked = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked;
  const showAll = params.all === "1";
  const [allTime, inMonth, loans, assets, debts] = await Promise.all([
    getAccountsWithBalances(db),
    getAccountsWithBalances(db, { from: `${month}-01`, to: monthEnd(month) }),
    db.loan.findMany({ select: { accountId: true, counterparty: true, kind: true, dueDate: true } }),
    db.fixedAsset.findMany({ select: { accountId: true, assetClass: true } }),
    db.debt.findMany({ select: { accountId: true, kind: true, lender: true } }),
  ]);
  const cur = user.currency;

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

  const totals = { money: sum(money), lent: sum(lent), assets: sum(fixed), owe: sum(owe) };
  const owned = totals.money + totals.lent + totals.assets;
  const netWorth = owned - totals.owe;
  const hidden = [...income, ...expenses].filter((a) => a.balance === ZERO).length;

  const row = (a: AccountWithBalance, detail?: string): Row => ({ id: a.id, href: `/accounts/${a.id}`, name: a.name, detail, balance: a.balance, icon: iconFor(a) });
  const moneyRows = money.map((a) => row(a, ASSET_SUBTYPES[a.subtype as keyof typeof ASSET_SUBTYPES]));
  const oweRows = owe.map((a) => {
    const d = debts.find((x) => x.accountId === a.id);
    const kind = d ? DEBT_KINDS[d.kind as keyof typeof DEBT_KINDS]?.label : a.subtype === "CARD" ? "Credit card" : "Loan";
    return row(a, [kind, d?.lender].filter(Boolean).join(" · "));
  });
  const assetRows = fixed.map((a) => {
    const f = assets.find((x) => x.accountId === a.id);
    return row(a, f ? ASSET_CLASSES[f.assetClass as keyof typeof ASSET_CLASSES]?.label : undefined);
  });
  // Lent out: one line per person; several loans to the same person fold into a group.
  const byPerson = new Map<string, Row[]>();
  for (const a of lent) {
    const l = loans.find((x) => x.accountId === a.id);
    const person = l?.counterparty ?? a.name;
    const kind = l ? LOAN_KINDS[l.kind as keyof typeof LOAN_KINDS]?.label : undefined;
    // Inside a person's group each line is named by its kind, e.g. "Cheque exchange · due 04/12/2026".
    const item = { ...row(a, l?.dueDate ? `due ${formatIsoDate(l.dueDate)}` : undefined), name: kind ?? a.name };
    byPerson.set(person, [...(byPerson.get(person) ?? []), item]);
  }
  const lentRows: Row[] = [...byPerson]
    .map(([person, items]) =>
      items.length === 1
        ? { ...items[0], name: person, detail: [items[0].name, items[0].detail].filter(Boolean).join(" · ") }
        : {
            id: `person-${person}`,
            href: items[0].href,
            name: person,
            detail: `${items.length} loans · ${[...new Set(items.map((i) => i.name))].join(", ")}`,
            balance: sum(items),
            icon: HandCoinsIcon,
            children: [...items].sort((x, y) => Number(y.balance - x.balance)),
          },
    )
    .sort((x, y) => Number(y.balance - x.balance));

  const parts: { key: string; label: string; value: bigint; tone: Tone }[] = [
    { key: "money", label: "Your money", value: totals.money, tone: "money" },
    { key: "lent", label: "Lent out & invested", value: totals.lent, tone: "lent" },
    { key: "assets", label: "Fixed assets", value: totals.assets, tone: "assets" },
  ];

  const link = (p: { month?: string; all?: boolean }) => {
    const q = new URLSearchParams();
    const m = p.month ?? month;
    if (m !== thisMonth) q.set("month", m);
    if (p.all ?? showAll) q.set("all", "1");
    const s = q.toString();
    return `/accounts${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <WidePage />
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Accounts" description="Balances are always calculated from your transactions." />
        <Button variant="outline" className="h-10 gap-1.5" render={<Link href="/accounts/new" />} nativeButton={false}>
          <PlusIcon /> Add
        </Button>
      </div>

      {/* What you're worth, and what it's made of */}
      <section className="mb-6 rounded-xl border bg-card p-4 shadow-xs md:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <div>
            <p className="text-sm text-muted-foreground">Net worth · what you own − what you owe</p>
            <p className={cn("text-3xl font-semibold tracking-tight tabular-nums", netWorth < ZERO && "text-destructive")}>{formatMoney(netWorth, cur)}</p>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            Own <span className="font-medium text-foreground">{formatMoney(owned, cur)}</span> · owe <span className={cn("font-medium", TONES.owe.text)}>{formatMoney(totals.owe, cur)}</span>
          </p>
        </div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="What you own, by kind">
          {parts.map((p) => (
            <span key={p.key} className={cn("h-full border-r-2 border-card last:border-r-0", TONES[p.tone].bar)} style={{ width: `${pct(p.value, owned)}%` }} />
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
          {[...parts, { key: "owe", label: "You owe", value: totals.owe, tone: "owe" as Tone }].map((p) => (
            <div key={p.key} className="min-w-0">
              <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("size-2.5 shrink-0 rounded-sm", TONES[p.tone].bar)} />
                {p.label}
              </dt>
              <dd className="mt-0.5 flex items-baseline gap-2">
                <span className="font-semibold tabular-nums">{formatMoney(p.value, cur)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{pct(p.value, owned).toFixed(0)}%</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Section title="Your money" icon={WalletIcon} tone="money" rows={moneyRows} currency={cur} />
        <Section title="Money you owe" icon={CreditCardIcon} tone="owe" rows={oweRows} currency={cur} empty="No cards or loans." />
        <Section title="Lent out & invested" icon={HandCoinsIcon} tone="lent" rows={lentRows} currency={cur} empty="Nothing lent out right now." />
        <Section title="Fixed assets · worth now" icon={PackageIcon} tone="assets" rows={assetRows} currency={cur} empty="No assets yet." />
      </div>

      {/* Income and expenses for a month */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <CategoryList title="Income" icon={TrendingUpIcon} tone="income" accounts={income} currency={cur} showAll={showAll} />
          <CategoryList title="Expenses" icon={TrendingDownIcon} tone="expense" accounts={expenses} currency={cur} showAll={showAll} />
        </div>
      </section>

      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer px-1 text-sm text-muted-foreground select-none">Archived ({archived.length})</summary>
          <div className="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
            {archived.map((a) => (
              <Link key={a.id} href={`/accounts/${a.id}`} className="flex min-h-11 items-center justify-between px-3 text-sm text-muted-foreground hover:bg-muted/60">
                <span>{a.name}</span>
                <span className="tabular-nums">{formatMoney(a.balance, cur)}</span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
