"use client";

import { useActionState, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { selectClass } from "@/components/entry-form";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";
import { DEBT_KINDS, type DebtKind } from "@/lib/ledger/debt-kinds";
import type { Option } from "@/lib/ledger/form-data";
import { cn } from "@/lib/utils";
import { borrowAction, chargeAction, createDebtAction, deleteDebtAction, paymentAction, updateDebtAction } from "./actions";

function Picker({ id, name, label, options, defaultValue }: { id: string; name: string; label: string; options: Option[]; defaultValue?: string | null }) {
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

/** Default category for interest/fees: "Interest Paid" if it exists. */
const interestDefault = (categories: Option[]) => categories.find((c) => c.name === "Interest Paid")?.id ?? categories[0]?.id;

type Defaults = {
  name?: string;
  lender?: string;
  kind?: DebtKind;
  rate?: string;
  ratePeriod?: string;
  creditLimit?: string;
  dueDay?: string;
  monthlyPayment?: string;
  endDate?: string;
  notes?: string;
};

function DetailsFields({ defaults, onKind, lockKindTo }: { defaults: Defaults; onKind?: (k: DebtKind) => void; lockKindTo?: "card" | "loan" }) {
  const [kind, setKind] = useState<DebtKind>(defaults.kind ?? "CREDIT_CARD");
  const isCard = DEBT_KINDS[kind].isCard;
  const kinds = (Object.keys(DEBT_KINDS) as DebtKind[]).filter(
    (k) => !lockKindTo || (lockKindTo === "card") === DEBT_KINDS[k].isCard,
  );

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What is it?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {kinds.map((k) => (
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
                  onKind?.(k);
                }}
                className="sr-only"
              />
              {DEBT_KINDS[k].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={defaults.name} placeholder={isCard ? "e.g. Sampath Visa" : "e.g. Car loan"} maxLength={80} required />
        <Field label="Lender (optional)" name="lender" defaultValue={defaults.lender} placeholder="e.g. Sampath Bank" maxLength={80} />
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Interest rate % (optional)" name="rate" inputMode="decimal" defaultValue={defaults.rate} placeholder={isCard ? "e.g. 28" : "e.g. 12"} />
        <select name="ratePeriod" defaultValue={defaults.ratePeriod ?? "YEAR"} className={cn(selectClass, "w-auto")} aria-label="Rate period">
          <option value="YEAR">per year</option>
          <option value="MONTH">per month</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {isCard ? (
          <Field label="Credit limit (optional)" name="creditLimit" inputMode="decimal" defaultValue={defaults.creditLimit} placeholder="e.g. 300,000" />
        ) : (
          <Field label="Monthly instalment (optional)" name="monthlyPayment" inputMode="decimal" defaultValue={defaults.monthlyPayment} placeholder="e.g. 25,000" />
        )}
        <Field
          label="Payment due on day (optional)"
          name="dueDay"
          type="number"
          min={1}
          max={31}
          defaultValue={defaults.dueDay}
          placeholder="e.g. 25"
          hint="Day of the month. Used for reminders."
        />
      </div>
      {!isCard && <Field label="Ends on (optional)" name="endDate" type="date" defaultValue={defaults.endDate} />}
      <Field label="Notes (optional)" name="notes" defaultValue={defaults.notes} maxLength={1000} placeholder="e.g. Last 4 digits 1234, pawn ticket no." />
    </>
  );
}

export function NewDebtForm({ today, accounts, expenseCategories }: { today: string; accounts: Option[]; expenseCategories: Option[] }) {
  const [state, action] = useActionState(createDebtAction, undefined);
  const [isCard, setIsCard] = useState(true);
  const [startType, setStartType] = useState<"NONE" | "ALREADY_OWE" | "BORROW">("NONE");
  const choices = isCard
    ? ([
        ["NONE", "Nothing owed on it now"],
        ["ALREADY_OWE", "It already has a balance"],
      ] as const)
    : ([
        ["BORROW", "I'm borrowing the money now"],
        ["ALREADY_OWE", "I already owe on it"],
      ] as const);

  return (
    <form action={action} className="grid gap-5">
      <DetailsFields
        defaults={{}}
        onKind={(k) => {
          const card = DEBT_KINDS[k].isCard;
          setIsCard(card);
          setStartType(card ? "NONE" : "BORROW");
        }}
      />

      <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Starting point</legend>
          {choices.map(([value, label]) => (
            <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="startType" value={value} checked={startType === value} onChange={() => setStartType(value)} className="size-4 accent-primary" />
              {label}
            </label>
          ))}
        </fieldset>
        <Field label={startType === "BORROW" ? "Date borrowed" : "As of date"} name="startDate" type="date" defaultValue={today} max={today} required />
        {startType !== "NONE" && (
          <Field
            label={startType === "BORROW" ? "Amount borrowed (what you owe)" : "Balance you owe now"}
            name="amount"
            inputMode="decimal"
            placeholder="e.g. 500,000"
            required
          />
        )}
        {startType === "BORROW" && (
          <>
            <Field label="Fees deducted (optional)" name="fees" inputMode="decimal" placeholder="0.00" hint="e.g. a processing fee taken before you got the money. Counted as an expense." />
            <Picker id="intoAccountId" name="intoAccountId" label="Money went into" options={accounts} />
            <Picker id="feeAccountId" name="feeAccountId" label="Fees go to" options={expenseCategories} defaultValue={interestDefault(expenseCategories)} />
          </>
        )}
      </div>

      <FormMessage state={state} />
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}

export function EditDebtForm({ debtId, defaults }: { debtId: string; defaults: Defaults }) {
  const [state, action] = useActionState(updateDebtAction, undefined);
  const isCard = DEBT_KINDS[defaults.kind ?? "CREDIT_CARD"].isCard;
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="debtId" value={debtId} />
      <DetailsFields defaults={defaults} lockKindTo={isCard ? "card" : "loan"} />
      <p className="text-xs text-muted-foreground">To change an amount or date, delete that movement on its page and record it again.</p>
      <FormMessage state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function PaymentForm({
  debtId,
  today,
  currency,
  owed,
  suggestedInterest,
  suggestedTotal,
  accounts,
  expenseCategories,
}: {
  debtId: string;
  today: string;
  currency: string;
  owed: number;
  suggestedInterest: number;
  suggestedTotal: number | null;
  accounts: Option[];
  expenseCategories: Option[];
}) {
  const [state, action] = useActionState(paymentAction, undefined);
  const [paid, setPaid] = useState(suggestedTotal ? centsToInput(suggestedTotal) : "");
  const [interestText, setInterestText] = useState<string | null>(null); // null = automatic
  const [lastSaved, setLastSaved] = useState(state?.savedAt);
  if (state?.savedAt !== lastSaved) {
    setLastSaved(state?.savedAt);
    setPaid("");
    setInterestText(null);
  }

  // Suggested split: this month's interest first (loans), the rest comes off what you owe.
  const total = parseMoneyToCents(paid) ?? 0;
  const interest = interestText === null ? Math.min(total, suggestedInterest) : (parseMoneyToCents(interestText) ?? 0);
  const principal = Math.max(0, total - interest);
  const money = (c: number) => formatMoney(c, currency);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="debtId" value={debtId} />
      <input type="hidden" name="principal" value={centsToInput(principal)} />
      <input type="hidden" name="interest" value={centsToInput(interest)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid" name="paid" inputMode="decimal" placeholder="e.g. 25,000" value={paid} onChange={(e) => setPaid(e.target.value)} required />
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      {total > 0 && (
        <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="interestPart">Interest in this payment</Label>
            <Input
              id="interestPart"
              inputMode="decimal"
              value={interestText ?? centsToInput(interest)}
              onChange={(e) => setInterestText(e.target.value)}
              className="h-9 w-36 text-right tabular-nums"
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Comes off what you owe</span>
            <span className="font-medium tabular-nums">{money(principal)}</span>
          </div>
          {principal > owed && <p className="text-xs text-destructive">You only owe {money(owed)}. Put any extra under interest.</p>}
          <p className="text-xs text-muted-foreground">Still owed after this: {money(Math.max(0, owed - principal))}</p>
        </div>
      )}
      <Picker id="fromAccountId" name="fromAccountId" label="Paid from" options={accounts} />
      {interest > 0 && <Picker id="pay-interest" name="interestAccountId" label="Interest goes to" options={expenseCategories} defaultValue={interestDefault(expenseCategories)} />}
      <p className="text-xs text-muted-foreground">Paying off what you owe isn&apos;t an expense (the spending was counted already). Only the interest is.</p>
      <FormMessage state={state} />
      <SubmitButton>Record payment</SubmitButton>
    </form>
  );
}

export function ChargeForm({ debtId, today, expenseCategories }: { debtId: string; today: string; expenseCategories: Option[] }) {
  const [state, action] = useActionState(chargeAction, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.savedAt}>
      <input type="hidden" name="debtId" value={debtId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount charged" name="amount" inputMode="decimal" placeholder="e.g. 1,250" required />
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      <Picker id="charge-category" name="categoryId" label="Expense category" options={expenseCategories} defaultValue={interestDefault(expenseCategories)} />
      <Field label="Details (optional)" name="details" maxLength={200} placeholder="e.g. Statement interest, late fee" />
      <FormMessage state={state} />
      <SubmitButton variant="outline">Record interest / fees</SubmitButton>
    </form>
  );
}

export function BorrowForm({ debtId, today, accounts, expenseCategories, isCard }: { debtId: string; today: string; accounts: Option[]; expenseCategories: Option[]; isCard: boolean }) {
  const [state, action] = useActionState(borrowAction, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.savedAt}>
      <input type="hidden" name="debtId" value={debtId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={isCard ? "Cash advance amount" : "Amount borrowed"} name="amount" inputMode="decimal" placeholder="0.00" required />
        <Field label="Date" name="date" type="date" defaultValue={today} max={today} required />
      </div>
      <Field label="Fees deducted (optional)" name="fees" inputMode="decimal" placeholder="0.00" />
      <Picker id="borrow-into" name="intoAccountId" label="Money went into" options={accounts} />
      <Picker id="borrow-fee" name="feeAccountId" label="Fees go to" options={expenseCategories} defaultValue={interestDefault(expenseCategories)} />
      <FormMessage state={state} />
      <SubmitButton variant="outline">{isCard ? "Record cash advance" : "Record borrowing"}</SubmitButton>
    </form>
  );
}

export function DeleteDebtForm({ debtId }: { debtId: string }) {
  const [state, action] = useActionState(deleteDebtAction, undefined);
  return (
    <form
      action={action}
      className="grid gap-2"
      onSubmit={(e) => {
        if (!window.confirm("Delete this card / loan and everything recorded on its page? This can't be undone.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="debtId" value={debtId} />
      <SubmitButton variant="ghost" className="w-auto justify-start text-destructive">
        <Trash2Icon /> Delete
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
