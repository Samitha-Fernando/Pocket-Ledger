import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate, formatMoney } from "@/lib/format";
import { ASSET_SUBTYPES, TYPE_LABELS, naturalBalance } from "@/lib/ledger/accounts";
import { type EntryWithLines, describeEntry } from "@/lib/ledger/describe";
import type { AccountType } from "@/generated/prisma/client";
import { deleteAccount, moveAccount, setArchived } from "../actions";
import { RenameForm } from "../forms";

export const metadata = { title: "Account" };

/** Running balance after each line, oldest → newest; returned newest first. */
function withRunningBalance<L extends { amount: bigint; entry: EntryWithLines }>(type: AccountType, lines: L[]) {
  let running = BigInt(0);
  const rows = lines.map((line) => {
    const effect = naturalBalance(type, line.amount);
    running += effect;
    return { line, effect: Number(effect), after: running, view: describeEntry(line.entry) };
  });
  return rows.reverse();
}

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const account = await db.account.findUnique({ where: { id } });
  if (!account) notFound();

  const lines = await db.entryLine.findMany({
    where: { accountId: id },
    include: { entry: { include: { lines: { include: { account: true } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
  });

  const rows = withRunningBalance(account.type, lines);
  const balance = rows[0]?.after ?? BigInt(0);
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
          {formatMoney(balance, user.currency)}
        </p>
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
                  currency={user.currency}
                  amountOverride={effect}
                  trailing={
                    <span className="block text-xs text-muted-foreground">
                      {formatIsoDate(view.date)}
                      {isAsset && ` · bal ${formatMoney(after, user.currency)}`}
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
