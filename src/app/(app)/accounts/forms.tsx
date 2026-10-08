"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { selectClass } from "@/components/entry-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createAccount, renameAccount } from "./actions";

const TYPES = [
  { value: "ASSET", label: "Your money", hint: "Cash, bank, savings" },
  { value: "INCOME", label: "Income category", hint: "e.g. Freelance" },
  { value: "EXPENSE", label: "Expense category", hint: "e.g. Pets" },
];

export function NewAccountForm({ today }: { today: string }) {
  const [state, action] = useActionState(createAccount, undefined);
  const [type, setType] = useState("ASSET");

  return (
    <form action={action} className="grid gap-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What is it?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={cn(
                "flex cursor-pointer flex-col rounded-lg border p-3 transition-colors hover:bg-muted",
                "has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              )}
            >
              <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="sr-only" />
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-muted-foreground">{t.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Name" name="name" required maxLength={60} placeholder={type === "ASSET" ? "e.g. Sampath Bank" : ""} />

      {type === "ASSET" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="subtype">Type</Label>
            <select id="subtype" name="subtype" defaultValue="BANK" className={selectClass}>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank account</option>
              <option value="SAVINGS">Savings</option>
              <option value="OTHER">Other (e.g. e-wallet)</option>
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting balance (optional)" name="openingAmount" inputMode="decimal" placeholder="0.00" hint="What's in it on the date →" />
            <Field label="As of date" name="openingDate" type="date" defaultValue={today} />
          </div>
        </>
      )}

      <FormMessage state={state} />
      <SubmitButton>Add account</SubmitButton>
    </form>
  );
}

export function RenameForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameAccount, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-end gap-2">
        <Field label="Name" name="name" defaultValue={name} required maxLength={60} className="flex-1" />
        <SubmitButton variant="outline" className="w-auto">
          Rename
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
