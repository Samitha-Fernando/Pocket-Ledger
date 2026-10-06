import { ChartLineIcon } from "lucide-react";
import { ComingSoon, PageHeader } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Home" };

const TILES = [
  { label: "Net worth", phase: "Phase 6" },
  { label: "Cash & bank", phase: "Phase 1" },
  { label: "Savings", phase: "Phase 1" },
  { label: "Lent out", phase: "Phase 3" },
  { label: "Fixed assets", phase: "Phase 2" },
  { label: "Debts", phase: "Phase 4" },
];

export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} description={`Today is ${formatDate(new Date())}`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {TILES.map((tile) => (
          <div key={tile.label} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground/60">
              {formatMoney(0, user.currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.phase}</p>
          </div>
        ))}
      </div>
      <ComingSoon icon={ChartLineIcon} phase="Phase 6">
        Your dashboard will show net worth over time, income vs expenses, savings rate, top spending
        categories and what is due soon.
      </ComingSoon>
    </>
  );
}
