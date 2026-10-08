import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { EntryForm } from "@/components/entry-form";
import { Card, CardContent } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatDateTime, todayIso } from "@/lib/format";
import { KIND_LABELS, describeEntry } from "@/lib/ledger/describe";
import { getFormData } from "@/lib/ledger/form-data";
import { DeleteEntryButton } from "./delete-button";

export const metadata = { title: "Edit transaction" };

export default async function EditEntryPage({ params }: PageProps<"/history/[id]">) {
  const { user, db } = await getLedger();
  const { id } = await params;
  const raw = await db.entry.findUnique({ where: { id }, include: { lines: { include: { account: true } } } });
  if (!raw) notFound();
  const entry = describeEntry(raw);
  const data = await getFormData(db);

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href={`/history?month=${entry.date.slice(0, 7)}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" /> History
      </Link>
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
    </div>
  );
}
