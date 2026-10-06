"use client";

import { useFormStatus } from "react-dom";
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/auth/validate";

/** Labelled input with large, phone-friendly touch target. */
export function Field({
  label,
  hint,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-11 text-base md:text-sm" {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  children,
  className,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className={cn("h-11 w-full text-base", className)}>
      {pending && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state?.error && !state?.success) return null;
  const isError = Boolean(state.error);
  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        isError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      {isError ? <CircleAlertIcon className="mt-0.5 size-4 shrink-0" /> : <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />}
      {state.error ?? state.success}
    </p>
  );
}
