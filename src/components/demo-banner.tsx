import { FlaskConicalIcon } from "lucide-react";

/** True when the app is running on the fake demo database (npm run dev:demo). */
export function isDemoDatabase() {
  return (process.env.DATABASE_URL ?? "").includes("demo.db");
}

/** A bright strip so you always know you're looking at fake demo data. */
export function DemoBanner() {
  if (!isDemoDatabase()) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
      <FlaskConicalIcon className="size-3.5" />
      DEMO DATA · fake people and numbers
    </div>
  );
}
