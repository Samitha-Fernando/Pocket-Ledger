import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, CreditCardIcon, HandCoinsIcon, PackageIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { EntryForm } from "@/components/entry-form";
import { EntryRow } from "@/components/entry-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatDateTime, todayIso } from "@/lib/format";
import { KIND_LABELS, describeEntry } from "@/lib/ledger/describe";
import { FORM_KINDS } from "@/lib/ledger/engine";
import { getFormData } from "@/lib/ledger/form-data";
import { DeleteEntryButton } from "./delete-button";

export const metadata = { title: "Edit transaction" };

export default async function EditEntryPage({ params }: PageProps<"/history/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const raw = await db.entry.findUnique({
    where: { id },
    include: {
      lines: { include: { account: true } },
      asset: { select: { name: true } },
      loan: { select: { counterparty: true } },
      importRow: { select: { rowNumber: true, raw: true, batch: { select: { id: true, fileName: true } } } },
    },
  });
  if (!raw) notFound();
  const entry = describeEntry(raw);
  // Where it came from, if it was imported from a spreadsheet (kept for audit).
  const original = raw.importRow ? (JSON.parse(raw.importRow.raw) as Record<string, unknown>) : null;
  const imported = raw.importRow && original && (
    <div className="mt-4 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
      <p className="mb-1 font-medium text-foreground">
        Imported from row {raw.importRow.rowNumber} of{" "}
        <Link href={`/import/${raw.importRow.batch.id}`} className="underline underline-offset-2">
          {raw.importRow.batch.fileName}
        </Link>
      </p>
      <p className="break-words">
        {Object.entries(original)
          .map(([k, v]) => `${k}: ${v ?? "—"}`)
          .join(" · ")}
      </p>
    </div>
  );
  const back = (
    <Link
      href={`/history?month=${entry.date.slice(0, 7)}`}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeftIcon className="size-4" /> History
    </Link>
  );

  // Asset and loan entries are managed on the asset's / loan's own page.
  if (!FORM_KINDS.includes(raw.kind) || raw.debtId) {
    const owner = raw.debtId
      ? { href: `/debts/${raw.debtId}`, label: entry.debtName ?? "card or loan", what: "cards & loans register", icon: CreditCardIcon }
      : raw.loanId
      ? { href: `/loans/${raw.loanId}`, label: entry.loanName ?? "loan", what: "lending register", icon: HandCoinsIcon }
      : raw.assetId
        ? { href: `/assets/${raw.assetId}`, label: entry.assetName ?? "asset", what: "asset register", icon: PackageIcon }
        : null;
    return (
      <div className="mx-auto max-w-xl">
        {back}
        <PageHeader title={KIND_LABELS[entry.kind]} description={`Added ${formatDateTime(raw.createdAt)}`} />
        <div className="mb-4 overflow-hidden rounded-xl border bg-card">
          <EntryRow entry={entry} currency={user.currency} />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          This is part of the {owner?.what ?? "registers"}. To change or remove it, open its page.
        </p>
        {imported}
        {owner && (
          <Button className="h-11 gap-2" render={<Link href={owner.href} />} nativeButton={false}>
            <owner.icon /> Open {owner.label}
          </Button>
        )}
      </div>
    );
  }

  const data = await getFormData(db, user.assetThresholdCents);
  return (
    <div className="mx-auto max-w-xl">
      {back}
      <PageHeader
        title={`Edit ${KIND_LABELS[entry.kind].toLowerCase()}`}
        description={`Added ${formatDateTime(raw.createdAt)}${raw.updatedAt.getTime() - raw.createdAt.getTime() > 1000 ? ` · last changed ${formatDateTime(raw.updatedAt)}` : ""}`}
      />
      <Card>
        <CardContent className="grid gap-4">
          <EntryForm data={data} today={todayIso(user.timezone)} currency={user.currency} entry={entry} />
          <DeleteEntryButton entryId={entry.id} />
        </CardContent>
      </Card>
      {imported}
      {entry.kind === "EXPENSE" && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Bought something that lasts? Switch on &ldquo;Record as asset?&rdquo; above to convert this expense into an asset.
        </p>
      )}
    </div>
  );
}
