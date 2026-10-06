import { cn } from "@/lib/utils";

/** Pocket Ledger logo mark: a ledger page with a balance tick. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M9 10h14M9 15h14M9 20h7" className="stroke-primary-foreground" strokeWidth="2.2" strokeLinecap="round" />
      <path d="m18.5 21 2 2 3.5-4" className="stroke-primary-foreground" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      Pocket Ledger
    </span>
  );
}
