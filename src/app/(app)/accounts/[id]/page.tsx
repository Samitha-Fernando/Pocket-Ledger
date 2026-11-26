import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney } from "@/lib/format";
import { ASSET_SUBTYPES, TYPE_LABELS, naturalBalance } from "@/lib/ledger/accounts";
import { type EntryWithLines, describeEntry } from "@/lib/ledger/describe";
import type { AccountType } from "@/generated/prisma/client";
import { formatRate, rateOn, toBase } from "@/lib/ledger/fx";
import { deleteAccount, moveAccount, setArchived } from "../actions";
import { RenameForm } from "../forms";

export const metadata = { title: "Account" };

/** Running balance after each line, oldest → newest; returned newest first. Foreign accounts count in their own currency. */
function withRunningBalance<L extends { amount: bigint; foreignAmount: bigint | null; entry: EntryWithLines }>(type: AccountType, lines: L[], foreign: boolean) {
  let running = BigInt(0);
  const rows = lines.map((line) => {
    const effect = naturalBalance(type, foreign ? (line.foreignAmount ?? BigInt(0)) : line.amount);
    running += effect;
    return { line, effect: Number(effect), after: running, view: describeEntry(line.entry) };
  });
  return rows.reverse();
}

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const account = await db.account.findUnique({
    where: { id },
    include: { fixedAsset: { select: { id: true } }, loan: { select: { id: true } }, debt: { select: { id: true } } },
  });
  if (!account) notFound();
  // Fixed assets and loans are shown on their own register pages.
  if (account.fixedAsset) redirect(`/assets/${account.fixedAsset.id}`);
  if (account.loan) redirect(`/loans/${account.loan.id}`);
  if (account.debt) redirect(`/debts/${account.debt.id}`);

  const lines = await db.entryLine.findMany({
    where: { accountId: id },
    include: { entry: { include: { lines: { include: { account: true } }, asset: { select: { name: true } }, loan: { select: { counterparty: true } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
  });

  const shownIn = account.currency ?? user.currency;
  const rows = withRunningBalance(account.type, lines, Boolean(account.currency));
  const balance = rows[0]?.after ?? BigInt(0);
  // Foreign-currency account: what it's worth at the latest rate, and what that money cost.
  const rate = account.currency ? rateOn(await db.exchangeRate.findMany({ where: { currency: account.currency } }), account.currency, "9999-12-31") : null;
  const cost = account.currency ? lines.reduce((s, l) => s + l.amount, BigInt(0)) : BigInt(0);
  const worth = rate ? toBase(balance, rate.rate4) : null;
  const isAsset = account.type === "ASSET";
  const subtitle = isAsset ? ASSET_SUBTYPES[account.subtype as keyof typeof ASSET_SUBTYPES] : TYPE_LABELS[account.type];

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> Accounts
      </Link>

      <div className="mb-5">
        <p className="text-sm text-muted-foreground">
          {subtitle}
          {account.archived && " · Archived"}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${balance < BigInt(0) ? "text-destructive" : ""}`}>
          {formatMoney(balance, shownIn)}
        </p>
        {account.currency && (
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {worth !== null && rate ? (
              <>
                Worth <span className="font-medium text-foreground">{formatMoney(worth, user.currency)}</span> at {formatRate(rate.rate4)} ({formatIsoDate(rate.date)}) · cost{" "}
                {formatMoney(cost, user.currency)} ·{" "}
                <span className={worth - cost >= BigInt(0) ? "text-tone-income" : "text-tone-owe"}>
                  {worth - cost >= BigInt(0) ? "+" : ""}
                  {formatMoney(worth - cost, user.currency)} not yet converted
                </span>
              </>
            ) : (
              <>Cost {formatMoney(cost, user.currency)} · add an exchange rate in Settings to see what it&apos;s worth now</>
            )}
          </p>
        )}
        {!isAsset && <p className="text-xs text-muted-foreground">Total of all time</p>}
      </div>

      <section className="mb-6">
        <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Transactions ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {rows.map(({ line, effect, after, view }) => (
              <div key={line.id}>
                <EntryRow
                  entry={view}
                  currency={shownIn}
                  amountOverride={effect}
                  trailing={
                    <span className="block text-xs text-muted-foreground">
                      {formatIsoDate(view.date)}
                      {isAsset && ` · bal ${formatMoney(after, shownIn)}`}
                    </span>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {!account.isSystem && (
        <Card>
          <CardHeader>
            <CardTitle>Manage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <RenameForm id={account.id} name={account.name} />
            <div className="flex flex-wrap gap-2">
              {(["up", "down"] as const).map((direction) => (
                <form key={direction} action={moveAccount}>
                  <input type="hidden" name="id" value={account.id} />
                  <input type="hidden" name="direction" value={direction} />
                  <Button type="submit" variant="outline" className="h-10 gap-1.5">
                    {direction === "up" ? <ArrowUpIcon /> : <ArrowDownIcon />} Move {direction}
                  </Button>
                </form>
              ))}
              <form action={setArchived}>
                <input type="hidden" name="id" value={account.id} />
                <input type="hidden" name="archived" value={String(!account.archived)} />
                <Button type="submit" variant="outline" className="h-10 gap-1.5">
                  {account.archived ? <UndoIcon /> : <ArchiveIcon />} {account.archived ? "Unarchive" : "Archive"}
                </Button>
              </form>
              {lines.length === 0 && (
                <form action={deleteAccount}>
                  <input type="hidden" name="id" value={account.id} />
                  <Button type="submit" variant="destructive" className="h-10 gap-1.5">
                    <Trash2Icon /> Delete
                  </Button>
                </form>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {lines.length === 0
                ? "This account has never been used, so it can be deleted."
                : "Used accounts can't be deleted, so your history stays complete. Archive it to hide it from forms."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
