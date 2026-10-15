"use client";

import { useActionState, useState } from "react";
import { selectClass } from "@/components/entry-form";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";
import type { Option } from "@/lib/ledger/form-data";
import { LOAN_KINDS, type LoanKind } from "@/lib/ledger/loan-kinds";
import { cn } from "@/lib/utils";
import { createLoanAction, lendMoreAction, receiveBackAction, updateLoanAction, writeOffAction } from "./actions";

/** "2026-10-15" + 1 month → "2026-11-15" (clamped to the month's last day). */
function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function AccountPicker({ id, name, label, options, defaultValue }: { id: string; name: string; label: string; options: Option[]; defaultValue?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={name} className={selectClass} defaultValue={defaultValue ?? options[0]?.id} required>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

type Defaults = {
  counterparty?: string;
  kind?: LoanKind;
  rate?: string;
  ratePeriod?: string;
  dueDate?: string;
  interestAccountId?: string | null;
  notes?: string;
};

/** Who / what kind / rate / due date / interest category / notes. */
function DetailsFields({
  defaults,
  incomeCategories,
  startDate,
  onRateChange,
}: {
  defaults: Defaults;
  incomeCategories: Option[];
  startDate: string;
  /** Lets the New form suggest the interest to keep up front. */
  onRateChange?: (rate: string) => void;
}) {
  const categoryFor = (k: LoanKind) => incomeCategories.find((c) => c.name === LOAN_KINDS[k].interestCategory)?.id ?? incomeCategories[0]?.id ?? "";
  const [kind, setKind] = useState<LoanKind>(defaults.kind ?? "CHEQUE_EXCHANGE");
  const [period, setPeriod] = useState(defaults.ratePeriod ?? LOAN_KINDS[kind].ratePeriod);
  const [category, setCategory] = useState(defaults.interestAccountId ?? categoryFor(kind));
  const [dueDate, setDueDate] = useState(defaults.dueDate ?? "");

  return (
    <>
      <Field label="Who has the money?" name="counterparty" defaultValue={defaults.counterparty} placeholder="e.g. Kamal, Sampath Bank" maxLength={80} required />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(LOAN_KINDS) as LoanKind[]).map((k) => (
            <label
              key={k}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm transition-colors hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setPeriod(LOAN_KINDS[k].ratePeriod);
                  setCategory(categoryFor(k));
                }}
                className="sr-only"
              />
              {LOAN_KINDS[k].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field
          label="Interest rate % (optional)"
          name="rate"
          inputMode="decimal"
          defaultValue={defaults.rate}
          placeholder="e.g. 4"
          onChange={(e) => onRateChange?.(e.target.value)}
        />
        <select name="ratePeriod" value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(selectClass, "w-auto")} aria-label="Rate period">
          <option value="MONTH">per month</option>
          <option value="YEAR">per year</option>
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="dueDate">Due back (optional)</Label>
        <Input id="dueDate" name="dueDate" type="date" value={dueDate} min={startDate} onChange={(e) => setDueDate(e.target.value)} className="h-11 text-base md:text-sm" />
        <div className="flex flex-wrap gap-2">
          {[
            [1, "+1 month"],
            [3, "+3 months"],
            [6, "+6 months"],
            [12, "+1 year"],
          ].map(([n, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setDueDate(addMonths(startDate, n as number))}
              className="h-8 rounded-full border px-3 text-xs text-muted-foreground hover:bg-muted"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="interestAccountId">Interest goes to</Label>
        <select id="interestAccountId" name="interestAccountId" value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
          {incomeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <Field label="Notes (optional)" name="notes" defaultValue={defaults.notes} maxLength={1000} placeholder="e.g. Cheque no. 123456, Commercial Bank" />
    </>
  );
}

export function NewLoanForm({
  today,
  currency,
  accounts,
  incomeCategories,
}: {
  today: string;
  currency: string;
  accounts: Option[];
  incomeCategories: Option[];
}) {
  const [state, action] = useActionState(createLoanAction, undefined);
  const [startDate, setStartDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [upfront, setUpfront] = useState("");
  const [rate, setRate] = useState("");

  const amountCents = parseMoneyToCents(amount) ?? 0;
  const upfrontCents = parseMoneyToCents(upfront) ?? 0;
  const rateNumber = Number(rate);
  const oneMonthInterest = rateNumber > 0 && amountCents > 0 ? Math.round((amountCents * rateNumber) / 100) : 0;
  const money = (c: number) => formatMoney(c, currency);

  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount lent (what they owe you back)" name="amount" inputMode="decimal" placeholder="e.g. 100,000" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Field label="Date" name="startDate" type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} required />
      </div>

      <DetailsFields defaults={{}} incomeCategories={incomeCategories} startDate={startDate} onRateChange={setRate} />

      <div className="grid gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Label htmlFor="upfrontInterest">Interest kept up front (optional)</Label>
        <div className="flex gap-2">
          <Input id="upfrontInterest" name="upfrontInterest" inputMode="decimal" placeholder="0.00" value={upfront} onChange={(e) => setUpfront(e.target.value)} className="h-11 flex-1 text-base md:text-sm" />
          {oneMonthInterest > 0 && (
            <button type="button" onClick={() => setUpfront(centsToInput(oneMonthInterest))} className="h-11 shrink-0 rounded-lg border px-3 text-xs hover:bg-muted">
              Use {rate}% = {money(oneMonthInterest)}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          If you deduct your interest before handing over the money, enter it here.
          {amountCents > 0 && upfrontCents > 0 && upfrontCents < amountCents && (
            <>
              {" "}
              You hand over <strong>{money(amountCents - upfrontCents)}</strong>, {money(upfrontCents)} is counted as interest today, and they owe you{" "}
              <strong>{money(amountCents)}</strong>.
            </>
          )}
        </p>
      </div>

      <AccountPicker id="fromAccountId" name="fromAccountId" label="Money came from" options={accounts} />

      <FormMessage state={state} />
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}

export function EditLoanForm({
  loanId,
  startDate,
  defaults,
  incomeCategories,
}: {
  loanId: string;
  startDate: string;
  defaults: Defaults;
  incomeCategories: Option[];
}) {
  const [state, action] = useActionState(updateLoanAction, undefined);
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="loanId" value={loanId} />
      <DetailsFields defaults={defaults} incomeCategories={incomeCategories} startDate={startDate} />
      <p className="text-xs text-muted-foreground">
        To change an amount or date, delete that money movement on the loan&apos;s page and record it again.
      </p>
      <FormMessage state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function ReceiveBackForm({
  loanId,
  today,
  currency,
  outstanding,
  accounts,
  incomeCategories,
  interestAccountId,
}: {
  loanId: string;
  today: string;
  currency: string;
  outstanding: number;
  accounts: Option[];
  incomeCategories: Option[];
  interestAccountId?: string | null;
}) {
  const [state, action] = useActionState(receiveBackAction, undefined);
  const [received, setReceived] = useState("");
  const [principalText, setPrincipalText] = useState<string | null>(null); // null = automatic split
  const [lastSaved, setLastSaved] = useState(state?.savedAt);
  if (state?.savedAt !== lastSaved) {
    setLastSaved(state?.savedAt);
    setReceived("");
    setPrincipalText(null);
  }

  // Suggested split: principal first (up to what's still out), anything extra is interest.
  const total = parseMoneyToCents(received) ?? 0;
  const principal = principalText === null ? Math.min(total, outstanding) : (parseMoneyToCents(principalText) ?? 0);
  const interest = Math.max(0, total - principal);
  const money = (c: number) => formatMoney(c, currency);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="loanId" value={loanId} />
      <input type="hidden" name="principal" value={centsToInput(principal)} />
      <input type="hidden" name="interest" value={centsToInput(interest)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total received" name="received" inputMode="decimal" placeholder="e.g. 104,000" value={received} onChange={(e) => setReceived(e.target.value)} required />
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      {total > 0 && (
        <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="principalPart">Paying back the loan</Label>
            <Input
              id="principalPart"
              inputMode="decimal"
              value={principalText ?? centsToInput(principal)}
              onChange={(e) => setPrincipalText(e.target.value)}
              className="h-9 w-36 text-right tabular-nums"
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Interest</span>
            <span className="font-medium tabular-nums">{money(interest)}</span>
          </div>
          {principal > outstanding && <p className="text-xs text-destructive">Only {money(outstanding)} is still out.</p>}
          {principal > total && <p className="text-xs text-destructive">That&apos;s more than you received.</p>}
          <p className="text-xs text-muted-foreground">Still out after this: {money(Math.max(0, outstanding - principal))}</p>
        </div>
      )}
      <AccountPicker id="intoAccountId" name="intoAccountId" label="Money went into" options={accounts} />
      {interest > 0 && (
        <AccountPicker id="rb-interest" name="interestAccountId" label="Interest goes to" options={incomeCategories} defaultValue={interestAccountId ?? undefined} />
      )}
      <FormMessage state={state} />
      <SubmitButton>Record money received</SubmitButton>
    </form>
  );
}

export function LendMoreForm({
  loanId,
  today,
  accounts,
  incomeCategories,
  interestAccountId,
}: {
  loanId: string;
  today: string;
  accounts: Option[];
  incomeCategories: Option[];
  interestAccountId?: string | null;
}) {
  const [state, action] = useActionState(lendMoreAction, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.savedAt}>
      <input type="hidden" name="loanId" value={loanId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Extra amount lent" name="amount" inputMode="decimal" placeholder="0.00" required />
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      <Field label="Interest kept up front (optional)" name="upfrontInterest" inputMode="decimal" placeholder="0.00" />
      <AccountPicker id="lm-from" name="fromAccountId" label="Money came from" options={accounts} />
      <AccountPicker id="lm-interest" name="interestAccountId" label="Interest goes to" options={incomeCategories} defaultValue={interestAccountId ?? undefined} />
      <FormMessage state={state} />
      <SubmitButton variant="outline">Record extra lending</SubmitButton>
    </form>
  );
}

export function WriteOffForm({ loanId, today, outstanding }: { loanId: string; today: string; outstanding: string }) {
  const [state, action] = useActionState(writeOffAction, undefined);
  return (
    <form
      action={action}
      className="grid gap-3"
      onSubmit={(e) => {
        if (!window.confirm(`Write off ${outstanding} as a bad debt? You can undo this later.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="loanId" value={loanId} />
      <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      <Field label="Why? (optional)" name="details" maxLength={200} placeholder="e.g. Cheque bounced, can't reach them" />
      <FormMessage state={state} />
      <SubmitButton variant="outline" className="text-destructive">
        Write off {outstanding}
      </SubmitButton>
    </form>
  );
}
