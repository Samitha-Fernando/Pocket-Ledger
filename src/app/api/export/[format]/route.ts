import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/scoped";
import { exportBackup, exportCsv, exportWorkbook } from "@/lib/export/personal";
import { todayIso } from "@/lib/format";

// Downloads of YOUR data only: /api/export/xlsx, /api/export/csv, /api/export/backup
export async function GET(_req: Request, ctx: RouteContext<"/api/export/[format]">) {
  const current = await getCurrentSession();
  if (current.state !== "active") return new Response("Not signed in", { status: 401 });
  const { format } = await ctx.params;
  const db = scopedDb(prisma, current.user.id);
  const today = todayIso(current.user.timezone);
  const base = `pocket-ledger-${today}`;
  const headers = (type: string, name: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
  });

  switch (format) {
    case "xlsx":
      return new Response(new Uint8Array(await exportWorkbook(db, current.user, today)), {
        headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}.xlsx`),
      });
    case "csv":
      return new Response(await exportCsv(db), { headers: headers("text/csv; charset=utf-8", `${base}-transactions.csv`) });
    case "backup":
      return new Response(await exportBackup(db, current.user), { headers: headers("application/json", `${base}-backup.json`) });
    default:
      return new Response("Unknown format", { status: 404 });
  }
}
