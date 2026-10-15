import Link from "next/link";
import { ChevronRightIcon, FileSpreadsheetIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UploadForm } from "./forms";

export const metadata = { title: "Import" };

const STATUS: Record<string, { label: string; tone: string }> = {
  STAGED: { label: "Not posted yet", tone: "text-amber-700 dark:text-amber-400" },
  POSTED: { label: "Posted", tone: "text-emerald-700 dark:text-emerald-400" },
  UNDONE: { label: "Undone", tone: "text-muted-foreground" },
};

export default async function ImportPage() {
  const { db } = await getLedger();
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { rows: true } } } });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Import from Excel" description="Bring in your history from “Personal Budget Tracker” (or any sheet with Date, Type, Category, Amount, Details columns)." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload a spreadsheet</CardTitle>
          <CardDescription>
            The file is read once and not kept. Its rows go to a private staging area. Nothing is added to your books until you review and post them.
            Uploading a newer version later only adds the new rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      {batches.length > 0 && (
        <section>
          <h2 className="mb-1.5 px-1 text-sm font-medium text-muted-foreground">Your imports</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {batches.map((b) => (
              <Link key={b.id} href={`/import/${b.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-muted/60">
                <FileSpreadsheetIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.fileName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b._count.rows} rows · uploaded {formatDateTime(b.createdAt)}
                  </span>
                </span>
                <span className={cn("text-xs font-medium", STATUS[b.status]?.tone)}>{STATUS[b.status]?.label}</span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
