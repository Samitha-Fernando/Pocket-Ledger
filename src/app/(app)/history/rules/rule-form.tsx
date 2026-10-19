"use client";

import { useActionState } from "react";
import { selectClass } from "@/components/entry-form";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Label } from "@/components/ui/label";
import { createRuleAction } from "../actions";

type Opt = { value: string; label: string };

function Pick({ id, label, options, none }: { id: string; label: string; options: Opt[]; none: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={id} defaultValue="" className={selectClass}>
        <option value="">{none}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RuleForm({ categories, assets, loans, accounts }: { categories: Opt[]; assets: Opt[]; loans: Opt[]; accounts: Opt[] }) {
  const [state, action] = useActionState(createRuleAction, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.success}>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="If the details contain" name="contains" placeholder="e.g. TW" maxLength={100} required hint="Upper/lower case doesn't matter." />
        <div className="grid gap-1.5">
          <Label htmlFor="appliesTo">On</Label>
          <select id="appliesTo" name="appliesTo" defaultValue="ANY" className={selectClass}>
            <option value="ANY">Expenses & income</option>
            <option value="EXPENSE">Expenses only</option>
            <option value="INCOME">Income only</option>
          </select>
        </div>
      </div>
      <p className="text-sm font-medium">Then (choose one or more)</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Pick id="categoryId" label="Set category" options={categories} none="Don't change" />
        <Pick id="accountId" label="Set account" options={accounts} none="Don't change" />
        {assets.length > 0 && <Pick id="assetId" label="Link to asset (expenses)" options={assets} none="Don't link" />}
        {loans.length > 0 && <Pick id="loanId" label="Link to loan (income)" options={loans} none="Don't link" />}
      </div>
      <FormMessage state={state} />
      <SubmitButton>Save rule</SubmitButton>
    </form>
  );
}
