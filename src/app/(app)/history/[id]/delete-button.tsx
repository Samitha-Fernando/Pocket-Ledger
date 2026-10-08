"use client";

import { Trash2Icon } from "lucide-react";
import { SubmitButton } from "@/components/form-bits";
import { deleteEntryAction } from "../../entries/actions";

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  return (
    <form
      action={deleteEntryAction}
      onSubmit={(e) => {
        if (!window.confirm("Delete this transaction? Balances will be recalculated.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="entryId" value={entryId} />
      <SubmitButton variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Trash2Icon /> Delete transaction
      </SubmitButton>
    </form>
  );
}
