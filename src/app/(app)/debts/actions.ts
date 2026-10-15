"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, getLedger } from "@/lib/auth/session";
import { field } from "@/lib/auth/validate";
import { formatMoney, parseMoneyToCents, todayIso } from "@/lib/format";
import { LedgerError } from "@/lib/ledger/engine";
import {
  type DebtDetails,
  type NewDebtInput,
  addCharge,
  borrowMore,
  createDebt,
  deleteDebt,
  deleteDebtMovement,
  makePayment,
  updateDebtDetails,
} from "@/lib/ledger/debts";
import { parseRate } from "@/lib/ledger/loans";

export type DebtFormState = { error?: string; success?: string; savedAt?: number } | undefined;

/** Optional money field: blank → 0, invalid → null. */
function optionalCents(fd: FormData, name: string) {
  const text = field(fd, name);
  return text ? parseMoneyToCents(text) : 0;
}

function readDetails(fd: FormData): DebtDetails | string {
  const rateText = field(fd, "rate");
  const rate = rateText ? parseRate(rateText) : 0;
  if (rate === null) return "Enter the interest rate as a number, e.g. 28 or 1.5";
  const limit = optionalCents(fd, "creditLimit");
  const monthly = optionalCents(fd, "monthlyPayment");
  if (limit === null) return "Enter a valid credit limit, or leave it blank.";
  if (monthly === null) return "Enter a valid monthly payment, or leave it blank.";
  const dueDayText = field(fd, "dueDay");
  return {
    name: field(fd, "name"),
    lender: field(fd, "lender") || null,
    kind: field(fd, "kind"),
    endDate: field(fd, "endDate") || null,
    rateBasisPoints: rate,
    ratePeriod: field(fd, "ratePeriod"),
    creditLimit: limit || null,
    dueDay: dueDayText ? Number(dueDayText) : null,
    monthlyPayment: monthly || null,
    notes: field(fd, "notes") || null,
  };
}

async function attempt(fn: () => Promise<unknown>): Promise<DebtFormState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
  return undefined;
}

export async function createDebtAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const details = readDetails(fd);
  if (typeof details === "string") return { error: details };

  const startType = field(fd, "startType");
  let start: NewDebtInput["start"] = { type: "NONE" };
  if (startType === "ALREADY_OWE" || startType === "BORROW") {
    const amount = parseMoneyToCents(field(fd, "amount"));
    if (amount === null) return { error: "Enter the amount, e.g. 500,000" };
    if (startType === "ALREADY_OWE") {
      start = { type: "ALREADY_OWE", amount };
    } else {
      const fees = optionalCents(fd, "fees");
      if (fees === null) return { error: "Enter valid fees, or leave them blank." };
      start = { type: "BORROW", amount, fees, intoAccountId: field(fd, "intoAccountId"), feeAccountId: field(fd, "feeAccountId") || null };
    }
  }

  let debtId = "";
  const result = await attempt(async () => {
    debtId = await createDebt(db, { ...details, startDate: field(fd, "startDate"), start }, todayIso(user.timezone));
  });
  if (result?.error) return result;
  await audit(user.id, "debt_created", details.name);
  revalidatePath("/", "layout");
  redirect(`/debts/${debtId}`);
}

export async function updateDebtAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const id = field(fd, "debtId");
  const details = readDetails(fd);
  if (typeof details === "string") return { error: details };
  const result = await attempt(() => updateDebtDetails(db, id, details));
  if (result?.error) return result;
  await audit(user.id, "debt_updated", details.name);
  revalidatePath("/", "layout");
  redirect(`/debts/${id}`);
}

export async function paymentAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const principal = optionalCents(fd, "principal");
  const interest = optionalCents(fd, "interest");
  if (principal === null || interest === null) return { error: "Enter valid amounts, e.g. 25,000" };
  let status = "";
  const result = await attempt(async () => {
    status = await makePayment(
      db,
      field(fd, "debtId"),
      {
        date: field(fd, "date"),
        principal,
        interest,
        fromAccountId: field(fd, "fromAccountId"),
        interestAccountId: field(fd, "interestAccountId") || null,
        details: field(fd, "details") || null,
      },
      todayIso(user.timezone),
    );
  });
  if (result?.error) return result;
  await audit(user.id, "debt_payment", formatMoney(principal + interest, user.currency));
  revalidatePath("/", "layout");
  return { success: status === "PAID_OFF" ? "Payment recorded. Nothing is owed now, so it's marked Paid off." : "Payment recorded.", savedAt: Date.now() };
}

export async function borrowAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const amount = parseMoneyToCents(field(fd, "amount"));
  if (amount === null) return { error: "Enter the amount, e.g. 50,000" };
  const fees = optionalCents(fd, "fees");
  if (fees === null) return { error: "Enter valid fees, or leave them blank." };
  const result = await attempt(() =>
    borrowMore(
      db,
      field(fd, "debtId"),
      { date: field(fd, "date"), amount, fees, intoAccountId: field(fd, "intoAccountId"), feeAccountId: field(fd, "feeAccountId") || null, details: field(fd, "details") || null },
      todayIso(user.timezone),
    ),
  );
  if (result?.error) return result;
  await audit(user.id, "debt_borrowed", formatMoney(amount, user.currency));
  revalidatePath("/", "layout");
  return { success: `Recorded ${formatMoney(amount, user.currency)} borrowed.`, savedAt: Date.now() };
}

export async function chargeAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const amount = parseMoneyToCents(field(fd, "amount"));
  if (amount === null) return { error: "Enter the amount, e.g. 1,250" };
  const result = await attempt(() =>
    addCharge(db, field(fd, "debtId"), { date: field(fd, "date"), amount, categoryId: field(fd, "categoryId"), details: field(fd, "details") || null }, todayIso(user.timezone)),
  );
  if (result?.error) return result;
  await audit(user.id, "debt_charge", formatMoney(amount, user.currency));
  revalidatePath("/", "layout");
  return { success: "Interest / fees recorded.", savedAt: Date.now() };
}

export async function deleteDebtMovementAction(fd: FormData) {
  const { user, db } = await getLedger();
  const result = await attempt(() => deleteDebtMovement(db, field(fd, "entryId")));
  if (!result?.error) await audit(user.id, "debt_movement_deleted");
  revalidatePath("/", "layout");
}

export async function deleteDebtAction(_prev: DebtFormState, fd: FormData): Promise<DebtFormState> {
  const { user, db } = await getLedger();
  const result = await attempt(() => deleteDebt(db, field(fd, "debtId")));
  if (result?.error) return result;
  await audit(user.id, "debt_deleted");
  revalidatePath("/", "layout");
  redirect("/debts");
}
