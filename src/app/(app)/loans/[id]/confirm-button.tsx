"use client";

import { Button } from "@/components/ui/button";

/** A submit button that asks "are you sure?" first. */
export function ConfirmButton({
  message,
  children,
  size,
  ariaLabel,
}: {
  message: string;
  children: React.ReactNode;
  size?: "icon";
  ariaLabel?: string;
}) {
  return (
    <Button
      type="submit"
      variant="ghost"
      size={size}
      aria-label={ariaLabel}
      className={size ? "text-muted-foreground hover:text-destructive" : "h-10 gap-1.5 text-destructive"}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
