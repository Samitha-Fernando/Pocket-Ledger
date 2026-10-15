import type { Debt } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate } from "@/lib/format";
import { CARD_SUBTYPE, LOAN_DEBT_SUBTYPE, isMoneyAccount, systemAccount } from "./accounts";
import { DEBT_KINDS, DUE_SOON_DAYS } from "./debt-kinds";
import { LedgerError, type Line, type Tx, postEntry } from "./engine";

export { DEBT_KINDS, DEBT_STATUS_LABELS, DUE_SOON_DAYS } from "./debt-kinds";

/**
 * Credit cards & loans you owe.
 *
 * Each debt has its own LIABILITY account; what you owe is its balance
 * (lines store money-in as +, so "owed" = −sum of lines).
 *   Already owe:     Opening Balances +X · Debt −X
 *   Borrow:          Debt −amount · Cash/bank +(amount − fees) · Fee expense +fees
 *   Card purchase:   a normal Expense paid from the card (Debt −X · Expense +X)
 *   Payment:         Cash/bank −paid · Debt +principal · Interest expense +interest
 *   Interest/fees:   Debt −X · Interest expense +X
 */

const ZERO = BigInt(0);

// ---- Pure helpers ------------------------------------------------------------

function shiftMonths(iso: string, n: number, day: number) {
  const [y, m] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** The due dates around today for a "due on day N of each month" debt. */
export function dueDates(dueDay: number, today: string) {
  const thisMonth = shiftMonths(today, 0, dueDay);
  const upcoming = today <= thisMonth ? thisMonth : shiftMonths(today, 1, dueDay);
  const previous = today <= thisMonth ? shiftMonths(today, -1, dueDay) : thisMonth;
  return { upcoming, previous };
}

/**
 * Due soon: a payment is due within 7 days and nothing has been paid since the
 * last due date. Overdue: a due date has passed and no payment was made for that
 * month's bill (paying late clears it). Pure.
 */
export function dueStatus(opts: { dueDay: number | null; today: string; startDate: string; owed: bigint; paymentDates: string[] }) {
  const { dueDay, today, startDate, owed, paymentDates } = opts;
  if (!dueDay || owed <= ZERO) return { overdue: false, dueSoon: false, nextDue: null as string | null };
  const { upcoming, previous } = dueDates(dueDay, today);
  const cycleStart = shiftMonths(previous, -1, dueDay);
  const paidAfter = (date: string) => paymentDates.some((d) => d > date && d <= today);

  const overdue = startDate <= cycleStart && previous < today && !paidAfter(cycleStart);
  const dueSoon = !overdue && daysBetween(today, upcoming) <= DUE_SOON_DAYS && !paidAfter(previous);
  return { overdue, dueSoon, nextDue: upcoming };
}

/** One month's interest on what's owed at the debt's rate (used to suggest a payment split). */
export function monthlyInterest(owed: bigint, rateBp: number, period: string) {
  if (owed <= ZERO || rateBp <= 0) return ZERO;
  const divisor = BigInt(period === "YEAR" ? 120_000 : 10_000);
  return (owed * BigInt(rateBp) + divisor / BigInt(2)) / divisor; // rounded to the cent
}

/** Payment lines: money out, principal off the debt, interest as an expense. Pure. */
export function paymentLines(ids: { money: string; debt: string; interest: string }, principal: bigint, interest: bigint): Line[] {
  return [
    { accountId: ids.money, amount: -(principal + interest) },
    { accountId: ids.debt, amount: principal },
    { accountId: ids.interest, amount: interest },
  ].filter((l) => l.amount !== ZERO);
}

/** Borrowing lines, with optional fees deducted before you receive the money. Pure. */
export function borrowLines(ids: { money: string; debt: string; fee?: string | null }, amount: bigint, fees: bigint): Line[] {
  return [
    { accountId: ids.debt, amount: -amount },
    { accountId: ids.money, amount: amount - fees },
    ...(fees > ZERO ? [{ accountId: ids.fee!, amount: fees }] : []),
  ];
}

// ---- Database helpers --------------------------------------------------------

export async function owedOn(tx: Tx, debt: Pick<Debt, "accountId">) {
  const r = await tx.entryLine.aggregate({ where: { accountId: debt.accountId }, _sum: { amount: true } });
  return -(r._sum.amount ?? ZERO);
}

async function loadDebt(tx: Tx, debtId: string) {
  const debt = await tx.debt.findUnique({ where: { id: debtId } });
  if (!debt) throw new LedgerError("That card or loan no longer exists.");
  return debt;
}

async function moneyAccount(tx: Tx, id: string, label: string) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || !isMoneyAccount(account) || account.isSystem || account.archived) {
    throw new LedgerError(`Choose a valid ${label}.`);
  }
  return account;
}

async function expenseCategory(tx: Tx, id: string | null | undefined) {
  const account = id ? await tx.account.findUnique({ where: { id } }) : null;
  if (!account || account.type !== "EXPENSE" || account.isSystem || account.archived) {
    throw new LedgerError("Choose an expense category for the interest or fees.");
  }
  return account;
}

function checkDate(date: string, today: string) {
  if (!isIsoDate(date)) throw new LedgerError("Choose a valid date.");
  if (date > today) throw new LedgerError("The date can't be in the future.");
}

function checkCents(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) throw new LedgerError(`Enter a valid ${label}.`);
}

/** Loans are "Paid off" when nothing is owed; cards stay open. */
async function refreshStatus(tx: Tx, debtId: string) {
  const debt = await loadDebt(tx, debtId);
  const owed = await owedOn(tx, debt);
  const isCard = DEBT_KINDS[debt.kind as keyof typeof DEBT_KINDS]?.isCard;
  const hasHistory = (await tx.entry.count({ where: { debtId } })) > 0;
  const status = !isCard && hasHistory && owed <= ZERO ? "PAID_OFF" : "ACTIVE";
  const last = status === "PAID_OFF" ? await tx.entry.findFirst({ where: { debtId, kind: "DEBT_PAYMENT" }, orderBy: { date: "desc" } }) : null;
  await tx.debt.update({ where: { id: debtId }, data: { status, closedDate: last?.date ?? null } });
  return status;
}

// ---- Creating / editing ------------------------------------------------------

export type DebtDetails = {
  name: string;
  lender?: string | null;
  kind: string;
  endDate?: string | null;
  rateBasisPoints: number;
  ratePeriod: string;
  creditLimit?: number | null; // cents
  dueDay?: number | null;
  monthlyPayment?: number | null; // cents
  notes?: string | null;
};

function validateDetails(d: DebtDetails) {
  if (!d.name.trim()) throw new LedgerError("Give it a name, e.g. Sampath Visa.");
  if (d.name.length > 80 || (d.lender && d.lender.length > 80)) throw new LedgerError("Name is too long (max 80 characters).");
  if (!(d.kind in DEBT_KINDS)) throw new LedgerError("Choose what kind of debt this is.");
  if (d.endDate && !isIsoDate(d.endDate)) throw new LedgerError("Choose a valid end date.");
  if (!Number.isInteger(d.rateBasisPoints) || d.rateBasisPoints < 0 || d.rateBasisPoints > 10_000) throw new LedgerError("Enter a valid interest rate.");
  if (d.ratePeriod !== "MONTH" && d.ratePeriod !== "YEAR") throw new LedgerError("Choose per month or per year.");
  if (d.creditLimit != null) checkCents(d.creditLimit, "credit limit", true);
  if (d.monthlyPayment != null) checkCents(d.monthlyPayment, "monthly payment", true);
  if (d.dueDay != null && (!Number.isInteger(d.dueDay) || d.dueDay < 1 || d.dueDay > 31)) throw new LedgerError("Due day must be between 1 and 31.");
  if (d.notes && d.notes.length > 1000) throw new LedgerError("Notes are too long.");
}

const detailData = (d: DebtDetails) => ({
  name: d.name.trim(),
  lender: d.lender?.trim() || null,
  kind: d.kind,
  endDate: d.endDate || null,
  rateBasisPoints: d.rateBasisPoints,
  ratePeriod: d.ratePeriod,
  creditLimit: d.creditLimit ? BigInt(d.creditLimit) : null,
  dueDay: d.dueDay || null,
  monthlyPayment: d.monthlyPayment ? BigInt(d.monthlyPayment) : null,
  notes: d.notes?.trim() || null,
});

export type NewDebtInput = DebtDetails & {
  startDate: string;
  /** How it starts: nothing owed yet (cards), already owe something, or borrowing now. */
  start:
    | { type: "NONE" }
    | { type: "ALREADY_OWE"; amount: number }
    | { type: "BORROW"; amount: number; fees: number; intoAccountId: string; feeAccountId?: string | null };
};

export async function createDebt(db: UserDb, input: NewDebtInput, today: string) {
  validateDetails(input);
  checkDate(input.startDate, today);
  if (input.endDate && input.endDate < input.startDate) throw new LedgerError("The end date can't be before the start date.");
  const isCard = DEBT_KINDS[input.kind as keyof typeof DEBT_KINDS].isCard;
  if (!isCard && input.start.type === "NONE") throw new LedgerError("Enter what you borrowed or what you owe now.");
  if (input.start.type !== "NONE") checkCents(input.start.amount, "amount");
  if (input.start.type === "BORROW") {
    checkCents(input.start.fees, "fees", true);
    if (input.start.fees >= input.start.amount) throw new LedgerError("Fees must be less than the amount borrowed.");
  }

  return db.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: { name: input.name.trim(), type: "LIABILITY", subtype: isCard ? CARD_SUBTYPE : LOAN_DEBT_SUBTYPE } as never,
    });
    const debt = await tx.debt.create({ data: { ...detailData(input), accountId: account.id, startDate: input.startDate } as never });

    if (input.start.type === "ALREADY_OWE") {
      const opening = await systemAccount(tx, "OPENING");
      await postEntry(tx, { kind: "OPENING_BALANCE", date: input.startDate, debtId: debt.id, details: "Balance owed when added" }, [
        { accountId: opening.id, amount: BigInt(input.start.amount) },
        { accountId: account.id, amount: BigInt(-input.start.amount) },
      ]);
    } else if (input.start.type === "BORROW") {
      await moneyAccount(tx, input.start.intoAccountId, "account the money went into");
      const fee = input.start.fees > 0 ? await expenseCategory(tx, input.start.feeAccountId) : null;
      await postEntry(
        tx,
        { kind: "BORROW", date: input.startDate, debtId: debt.id },
        borrowLines({ money: input.start.intoAccountId, debt: account.id, fee: fee?.id }, BigInt(input.start.amount), BigInt(input.start.fees)),
      );
    }
    return debt.id;
  });
}

export async function updateDebtDetails(db: UserDb, debtId: string, d: DebtDetails) {
  validateDetails(d);
  return db.$transaction(async (tx) => {
    const debt = await loadDebt(tx, debtId);
    const wasCard = DEBT_KINDS[debt.kind as keyof typeof DEBT_KINDS]?.isCard;
    const isCard = DEBT_KINDS[d.kind as keyof typeof DEBT_KINDS].isCard;
    if (wasCard !== isCard) throw new LedgerError("A credit card can't be changed into a loan (or the other way). Add a new one instead.");
    if (d.endDate && d.endDate < debt.startDate) throw new LedgerError("The end date can't be before the start date.");
    await tx.debt.update({ where: { id: debtId }, data: detailData(d) });
    await tx.account.update({ where: { id: debt.accountId }, data: { name: d.name.trim() } });
    await refreshStatus(tx, debtId);
  });
}

// ---- Money movements ---------------------------------------------------------

/** Borrow more (a new loan draw, a top-up, or a cash advance on a card). */
export async function borrowMore(
  db: UserDb,
  debtId: string,
  input: { date: string; amount: number; fees: number; intoAccountId: string; feeAccountId?: string | null; details?: string | null },
  today: string,
) {
  checkDate(input.date, today);
  checkCents(input.amount, "amount");
  checkCents(input.fees, "fees", true);
  if (input.fees >= input.amount) throw new LedgerError("Fees must be less than the amount borrowed.");
  return db.$transaction(async (tx) => {
    const debt = await loadDebt(tx, debtId);
    if (input.date < debt.startDate) throw new LedgerError("The date can't be before it started.");
    await moneyAccount(tx, input.intoAccountId, "account the money went into");
    const fee = input.fees > 0 ? await expenseCategory(tx, input.feeAccountId) : null;
    await postEntry(
      tx,
      { kind: "BORROW", date: input.date, debtId, details: input.details || null },
      borrowLines({ money: input.intoAccountId, debt: debt.accountId, fee: fee?.id }, BigInt(input.amount), BigInt(input.fees)),
    );
    return refreshStatus(tx, debtId);
  });
}

/** A payment: `principal` comes off what you owe; `interest` is an expense. */
export async function makePayment(
  db: UserDb,
  debtId: string,
  input: { date: string; principal: number; interest: number; fromAccountId: string; interestAccountId?: string | null; details?: string | null },
  today: string,
) {
  checkDate(input.date, today);
  checkCents(input.principal, "principal", true);
  checkCents(input.interest, "interest", true);
  if (input.principal + input.interest === 0) throw new LedgerError("Enter the amount you paid.");
  return db.$transaction(async (tx) => {
    const debt = await loadDebt(tx, debtId);
    if (input.date < debt.startDate) throw new LedgerError("The date can't be before it started.");
    const owed = await owedOn(tx, debt);
    if (BigInt(input.principal) > owed) throw new LedgerError("That's more than you owe. Put any extra under interest.");
    await moneyAccount(tx, input.fromAccountId, "account you paid from");
    const interest = input.interest > 0 ? await expenseCategory(tx, input.interestAccountId) : null;
    await postEntry(
      tx,
      { kind: "DEBT_PAYMENT", date: input.date, debtId, details: input.details || null },
      paymentLines({ money: input.fromAccountId, debt: debt.accountId, interest: interest?.id ?? "" }, BigInt(input.principal), BigInt(input.interest)),
    );
    return refreshStatus(tx, debtId);
  });
}

/** Interest or fees added to what you owe (e.g. from a card statement). */
export async function addCharge(
  db: UserDb,
  debtId: string,
  input: { date: string; amount: number; categoryId: string; details?: string | null },
  today: string,
) {
  checkDate(input.date, today);
  checkCents(input.amount, "amount");
  return db.$transaction(async (tx) => {
    const debt = await loadDebt(tx, debtId);
    if (input.date < debt.startDate) throw new LedgerError("The date can't be before it started.");
    const category = await expenseCategory(tx, input.categoryId);
    await postEntry(tx, { kind: "DEBT_CHARGE", date: input.date, debtId, details: input.details || "Interest / fees charged" }, [
      { accountId: debt.accountId, amount: BigInt(-input.amount) },
      { accountId: category.id, amount: BigInt(input.amount) },
    ]);
    return refreshStatus(tx, debtId);
  });
}

/** Removes one movement recorded on the debt's page (starting balance, borrowing, payment or charge). */
export async function deleteDebtMovement(db: UserDb, entryId: string) {
  return db.$transaction(async (tx) => {
    const entry = await tx.entry.findUnique({ where: { id: entryId } });
    if (!entry?.debtId) throw new LedgerError("That entry no longer exists.");
    await tx.entry.delete({ where: { id: entryId } });
    await refreshStatus(tx, entry.debtId);
  });
}

/** Deletes a card/loan and its own movements. Refused while card purchases still use it. */
export async function deleteDebt(db: UserDb, debtId: string) {
  return db.$transaction(async (tx) => {
    const debt = await loadDebt(tx, debtId);
    const purchases = await tx.entryLine.count({ where: { accountId: debt.accountId, entry: { debtId: null } } });
    if (purchases > 0) {
      throw new LedgerError(`${purchases} purchase(s) were paid with this card. Change or delete them first.`);
    }
    await tx.entry.deleteMany({ where: { debtId } });
    await tx.debt.delete({ where: { id: debtId } });
    await tx.account.delete({ where: { id: debt.accountId } });
  });
}

// ---- Reading -----------------------------------------------------------------

function debtEntries(db: UserDb, accountIds: string[]) {
  // Everything that touched the debt's account: its own movements and card purchases.
  return db.entry.findMany({
    where: { lines: { some: { accountId: { in: accountIds } } } },
    include: { lines: { include: { account: true } }, asset: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
}

type DebtEntry = Awaited<ReturnType<typeof debtEntries>>[number];

function summarise(debt: Debt, entries: DebtEntry[], today: string) {
  let owedRaw = ZERO;
  let borrowed = ZERO; // starting balance + borrowing + card purchases
  let paid = ZERO; // principal paid back
  let interestAndFees = ZERO; // interest in payments + charges + fees deducted
  const paymentDates: string[] = [];
  for (const e of entries) {
    const own = e.lines.filter((l) => l.accountId === debt.accountId).reduce((s, l) => s + l.amount, ZERO);
    owedRaw += own;
    if (own < ZERO && e.kind !== "DEBT_CHARGE") borrowed -= own;
    if (e.kind === "DEBT_PAYMENT") {
      paid += own;
      paymentDates.push(e.date);
    }
    if (e.debtId === debt.id && e.kind !== "OPENING_BALANCE") {
      interestAndFees += e.lines.filter((l) => l.account.type === "EXPENSE").reduce((s, l) => s + l.amount, ZERO);
    }
  }
  const owed = -owedRaw;
  const isCard = DEBT_KINDS[debt.kind as keyof typeof DEBT_KINDS]?.isCard ?? false;
  const due = dueStatus({ dueDay: debt.dueDay, today, startDate: debt.startDate, owed, paymentDates });
  return {
    owed,
    borrowed,
    paid,
    interestAndFees,
    isCard,
    available: isCard && debt.creditLimit ? debt.creditLimit - owed : null,
    suggestedInterest: isCard ? ZERO : monthlyInterest(owed, debt.rateBasisPoints, debt.ratePeriod),
    lastPayment: paymentDates.at(-1) ?? null,
    ...due,
  };
}

export type DebtSummary = ReturnType<typeof summarise> & { debt: Debt };

export async function getDebts(db: UserDb, today: string) {
  const debts = await db.debt.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
  const entries = debts.length ? await debtEntries(db, debts.map((d) => d.accountId)) : [];
  return debts.map((debt): DebtSummary => ({
    ...summarise(debt, entries.filter((e) => e.lines.some((l) => l.accountId === debt.accountId)), today),
    debt,
  }));
}

export async function getDebtDetails(db: UserDb, debtId: string, today: string) {
  const debt = await db.debt.findUnique({ where: { id: debtId } });
  if (!debt) return null;
  const entries = await debtEntries(db, [debt.accountId]);
  return { ...summarise(debt, entries, today), debt, entries };
}
