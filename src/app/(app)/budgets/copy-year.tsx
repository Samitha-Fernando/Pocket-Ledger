"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyYearAction } from "./actions";

/** Starts a year from the previous year's budget. */
export function CopyYearButton({ year }: { year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 gap-1.5 text-muted-foreground"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Copy ${year - 1}'s budget into ${year}? This replaces any amounts already planned for ${year}.`)) return;
        startTransition(async () => {
          await copyYearAction(year - 1, year);
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <CopyIcon />} Copy {year - 1}
    </Button>
  );
}
