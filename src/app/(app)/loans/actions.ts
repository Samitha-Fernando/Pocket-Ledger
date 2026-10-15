"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { formatMoney, parseMoneyToCents, todayIso } from "@/lib/format";
import { LedgerError } from "@/lib/ledger/engine";
import {
  type LoanDetails,
  createLoan,
  deleteLoan,
  deleteLoanMovement,
  lendMore,
  parseRate,
  receiveBack,
  updateLoanDetails,
  writeOff,
} from "@/lib/ledger/loans";

export type LoanFormState = { error?: string; success?: string; savedAt?: number } | undefined;

/** Optional money field: blank → 0, invalid → null. */
function optionalCents(fd: FormData, name: string) {
  const text = field(fd, name);
  return text ? parseMoneyToCents(text) : 0;
}

function readDetails(fd: FormData): LoanDetails | string {
  const rateText = field(fd, "rate");
  const rate = rateText ? parseRate(rateText) : 0;
  if (rate === null) return "Enter the interest rate as a number, e.g. 4 or 4.5";
  return {
    counterparty: field(fd, "counterparty"),
    kind: field(fd, "kind"),
    dueDate: field(fd, "dueDate") || null,
    rateBasisPoints: rate,
    ratePeriod: field(fd, "ratePeriod"),
    interestAccountId: field(fd, "interestAccountId") || null,
    notes: field(fd, "notes") || null,
  };
}

async function attempt(fn: () => Promise<unknown>): Promise<LoanFormState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return undefined;
}

export async function createLoanAction(_prev: LoanFormState, fd: FormData): Promise<LoanFormState> {
  const { user, db } = await getLedger();
  const details = readDetails(fd);
  if (typeof details === "string") return { error: details };
  const amount = parseMoneyToCents(field(fd, "amount"));
  if (amount === null) return { error: "Enter the amount, e.g. 100,000" };
  const upfront = optionalCents(fd, "upfrontInterest");
  if (upfront === null) return { error: "Enter the interest kept up front, or leave it blank." };

  let loanId = "";
  const result = await attempt(async () => {
    loanId = await createLoan(
      db,
      { ...details, startDate: field(fd, "startDate"), amount, upfrontInterest: upfront, fromAccountId: field(fd, "fromAccountId"), details: field(fd, "details") || null },
      todayIso(user.timezone),
    );
  });
  if (result?.error) return result;
  await audit(user.id, "loan_created", `${details.counterparty} ${formatMoney(amount, user.currency)}`);
  revalidatePath("/", "layout");
  redirect(`/loans/${loanId}`);
}

export async function updateLoanAction(_prev: LoanFormState, fd: FormData): Promise<LoanFormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "loanId");
  const details = readDetails(fd);
  if (typeof details === "string") return { error: details };
  const result = await attempt(() => updateLoanDetails(db, id, details));
  if (result?.error) return result;
  await audit(user.id, "loan_updated", details.counterparty);
  revalidatePath("/", "layout");
  redirect(`/loans/${id}`);
}

export async function lendMoreAction(_prev: LoanFormState, fd: FormData): Promise<LoanFormState> {
  const { user, db } = await getLedger();
  const amount = parseMoneyToCents(field(fd, "amount"));
  if (amount === null) return { error: "Enter the amount, e.g. 50,000" };
  const upfront = optionalCents(fd, "upfrontInterest");
  if (upfront === null) return { error: "Enter the interest kept up front, or leave it blank." };
  const result = await attempt(() =>
    lendMore(
      db,
      field(fd, "loanId"),
      {
        date: field(fd, "date"),
        amount,
        upfrontInterest: upfront,
        fromAccountId: field(fd, "fromAccountId"),
        interestAccountId: field(fd, "interestAccountId") || null,
        details: field(fd, "details") || null,
      },
      todayIso(user.timezone),
    ),
  );
  if (result?.error) return result;
  await audit(user.id, "loan_lent_more", formatMoney(amount, user.currency));
  revalidatePath("/", "layout");
  return { success: `Recorded ${formatMoney(amount, user.currency)} lent.`, savedAt: Date.now() };
}

export async function receiveBackAction(_prev: LoanFormState, fd: FormData): Promise<LoanFormState> {
  const { user, db } = await getLedger();
  const principal = optionalCents(fd, "principal");
  const interest = optionalCents(fd, "interest");
  if (principal === null || interest === null) return { error: "Enter valid amounts, e.g. 100,000" };
  let status = "";
  const result = await attempt(async () => {
    status = await receiveBack(
      db,
      field(fd, "loanId"),
      {
        date: field(fd, "date"),
        principal,
        interest,
        intoAccountId: field(fd, "intoAccountId"),
        interestAccountId: field(fd, "interestAccountId") || null,
        details: field(fd, "details") || null,
      },
      todayIso(user.timezone),
    );
  });
  if (result?.error) return result;
  await audit(user.id, "loan_money_back", formatMoney(principal + interest, user.currency));
  revalidatePath("/", "layout");
  return {
    success: status === "REPAID" ? "Recorded. Everything is back, so this is now marked Repaid." : "Recorded.",
    savedAt: Date.now(),
  };
}

export async function writeOffAction(_prev: LoanFormState, fd: FormData): Promise<LoanFormState> {
  const { user, db } = await getLedger();
  const result = await attempt(() => writeOff(db, field(fd, "loanId"), field(fd, "date"), todayIso(user.timezone), field(fd, "details") || null));
  if (result?.error) return result;
  await audit(user.id, "loan_written_off");
  revalidatePath("/", "layout");
  return { success: "Written off as a bad debt." };
}

export async function deleteMovementAction(fd: FormData) {
  const { user, db } = await getLedger();
  const result = await attempt(() => deleteLoanMovement(db, field(fd, "entryId")));
  if (!result?.error) await audit(user.id, "loan_movement_deleted");
  revalidatePath("/", "layout");
}

export async function deleteLoanAction(fd: FormData) {
  const { user, db } = await getLedger();
  const result = await attempt(() => deleteLoan(db, field(fd, "loanId")));
  if (result?.error) return;
  await audit(user.id, "loan_deleted");
  revalidatePath("/", "layout");
  redirect("/loans");
}
