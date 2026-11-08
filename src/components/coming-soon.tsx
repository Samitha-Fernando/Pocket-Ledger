import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Put on a page to let it use the full width of large screens (dashboards, wide tables). */
export function WidePage() {
  return <span data-wide-page hidden />;
}

/** Placeholder for screens that arrive in a later build phase. */
export function ComingSoon({ icon: Icon, phase, children }: { icon: LucideIcon; phase: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" />
      </span>
      <p className="text-xs font-medium tracking-wide text-primary uppercase">Coming in {phase}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
