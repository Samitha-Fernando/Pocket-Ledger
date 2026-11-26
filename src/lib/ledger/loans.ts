import type { Loan } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate } from "@/lib/format";
import { LENT_SUBTYPE, isMoneyAccount, systemAccount } from "./accounts";
import { LedgerError, type Line, type Tx, postEntry } from "./engine";
import { LOAN_KINDS } from "./loan-kinds";

export { LOAN_KINDS, LOAN_STATUS_LABELS } from "./loan-kinds";

/**
 * Lending & investments register.
 *
 * Each loan has its own ledger account; its balance is the money still out.
 *   Lend:          Cash/bank −(amount − upfront)  · Loan +amount · Interest −upfront
 *   Money back:    Cash/bank +received · Loan −principal part · Interest −interest part
 *   Interest only: an INCOME entry linked to the loan
 *   Write off:     Loan −still out · Bad debts +still out
 */

const ZERO = BigInt(0);

// ---- Pure helpers ------------------------------------------------------------

/** "4.5" → 450 basis points. Returns null if not a valid rate (0–100%, max 2 decimals). */
export function parseRate(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/%$/, ""));
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 450 → "4.5%" */
export function formatRate(bp: number, period?: string) {
  const text = `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  return period ? `${text} per ${period === "YEAR" ? "year" : "month"}` : text;
}

/** Whole months between two dates (rounded to the nearest month; at least 1). */
export function monthsBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / (86_400_000 * 30.4375)));
}

/** Simple interest on `amount` from start to due date at the loan's rate. */
export function expectedInterest(amount: bigint, rateBp: number, period: string, startDate: string, dueDate: string | null) {
  if (!dueDate || rateBp === 0) return null;
  const months = monthsBetween(startDate, dueDate);
  const periods = period === "YEAR" ? months : months * 12; // in twelfths of a year
  // amount × rate% × years, kept in integers: amount × bp × periods / (10,000 × 12)
  return (amount * BigInt(rateBp) * BigInt(periods)) / BigInt(120_000);
}

/** Lines for money received back, split into principal and interest. Pure. */
export function returnLines(ids: { money: string; loan: string; interest: string }, principal: bigint, interest: bigint): Line[] {
  return [
    { accountId: ids.money, amount: principal + interest },
    { accountId: ids.loan, amount: -principal },
    { accountId: ids.interest, amount: -interest },
  ].filter((l) => l.amount !== ZERO);
}

/** Lines for lending, with optional interest kept up front. Pure. */
export function lendLines(ids: { money: string; loan: string; interest?: string | null }, amount: bigint, upfront: bigint): Line[] {
  return [
    { accountId: ids.money, amount: -(amount - upfront) },
    { accountId: ids.loan, amount },
    ...(upfront > ZERO ? [{ accountId: ids.interest!, amount: -upfront }] : []),
  ];
}

// ---- Database helpers --------------------------------------------------------

export async function stillOut(tx: Tx, loan: Pick<Loan, "accountId">) {
  const r = await tx.entryLine.aggregate({ where: { accountId: loan.accountId }, _sum: { amount: true } });
  return r._sum.amount ?? ZERO;
}

async function loadLoan(tx: Tx, loanId: string) {
  const loan = await tx.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new LedgerError("That loan no longer exists.");
  return loan;
}

async function moneyAccount(tx: Tx, id: string, label: string) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || !isMoneyAccount(account) || account.isSystem || account.archived) {
    throw new LedgerError(`Choose a valid ${label}.`);
  }
  // Registers keep to the user's own currency; foreign accounts are for income, expenses and transfers.
  if (account.currency) throw new LedgerError(`${account.name} is in ${account.currency}. Use an account in your own currency here (move the money with a Transfer first).`);
  return account;
}

async function incomeCategory(tx: Tx, id: string | null | undefined) {
  const account = id ? await tx.account.findUnique({ where: { id } }) : null;
  if (!account || account.type !== "INCOME" || account.isSystem || account.archived) {
    throw new LedgerError("Choose an income category for the interest.");
  }
  return account;
}

function checkDate(date: string, today: string, label = "date") {
  if (!isIsoDate(date)) throw new LedgerError(`Choose a valid ${label}.`);
  if (date > today) throw new LedgerError(`The ${label} can't be in the future.`);
}

function checkCents(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new LedgerError(`Enter a valid ${label}.`);
  }
}

/** Works out the status from the ledger: written off, repaid, or still active. */
async function refreshStatus(tx: Tx, loanId: string) {
  const loan = await loadLoan(tx, loanId);
  const [out, lastMove, writeOff, lent] = await Promise.all([
    stillOut(tx, loan),
    tx.entry.findFirst({ where: { loanId, kind: { in: ["LOAN_RETURN", "LOAN_WRITE_OFF"] } }, orderBy: { date: "desc" } }),
    tx.entry.findFirst({ where: { loanId, kind: "LOAN_WRITE_OFF" } }),
    tx.entry.count({ where: { loanId, kind: "LEND" } }),
  ]);
  const status = out > ZERO || lent === 0 ? "ACTIVE" : writeOff ? "WRITTEN_OFF" : "REPAID";
  await tx.loan.update({
    where: { id: loanId },
    data: { status, closedDate: status === "ACTIVE" ? null : (lastMove?.date ?? null) },
  });
  return status;
}

// ---- Creating / editing ------------------------------------------------------

export type LoanDetails = {
  counterparty: string;
  kind: string;
  dueDate?: string | null;
  rateBasisPoints: number;
  ratePeriod: string;
  interestAccountId?: string | null;
  notes?: string | null;
};

function validateDetails(d: LoanDetails) {
  if (!d.counterparty.trim()) throw new LedgerError("Who has the money? Enter a name.");
  if (d.counterparty.length > 80) throw new LedgerError("Name is too long (max 80 characters).");
  if (!(d.kind in LOAN_KINDS)) throw new LedgerError("Choose what kind of loan or investment this is.");
  if (d.dueDate && !isIsoDate(d.dueDate)) throw new LedgerError("Choose a valid due date.");
  if (!Number.isInteger(d.rateBasisPoints) || d.rateBasisPoints < 0 || d.rateBasisPoints > 10_000) {
    throw new LedgerError("Enter a valid interest rate.");
  }
  if (d.ratePeriod !== "MONTH" && d.ratePeriod !== "YEAR") throw new LedgerError("Choose per month or per year.");
  if (d.notes && d.notes.length > 1000) throw new LedgerError("Notes are too long.");
}

const accountName = (d: Pick<LoanDetails, "counterparty" | "kind">) =>
  `${d.counterparty.trim()} (${LOAN_KINDS[d.kind as keyof typeof LOAN_KINDS].label.toLowerCase()})`;

export type NewLoanInput = LoanDetails & {
  startDate: string;
  amount: number; // full amount owed back (cents)
  upfrontInterest: number; // interest kept when handing over the money (cents)
  fromAccountId: string;
  details?: string | null;
};

/** Records lending money (or making an investment). Returns the new loan's id. */
export async function createLoan(db: UserDb, input: NewLoanInput, today: string) {
  validateDetails(input);
  checkDate(input.startDate, today, "start date");
  if (input.dueDate && input.dueDate < input.startDate) throw new LedgerError("The due date can't be before the start date.");
  checkCents(input.amount, "amount");
  checkCents(input.upfrontInterest, "interest kept up front", true);
  if (input.upfrontInterest >= input.amount) throw new LedgerError("Interest kept up front must be less than the amount.");

  return db.$transaction(async (tx) => {
    await moneyAccount(tx, input.fromAccountId, "account the money came from");
    const interest = input.interestAccountId ? await incomeCategory(tx, input.interestAccountId) : null;
    if (input.upfrontInterest > 0 && !interest) await incomeCategory(tx, null);

    const account = await tx.account.create({
      data: { name: accountName(input), type: "ASSET", subtype: LENT_SUBTYPE } as never,
    });
    const loan = await tx.loan.create({
      data: {
        accountId: account.id,
        counterparty: input.counterparty.trim(),
        kind: input.kind,
        startDate: input.startDate,
        dueDate: input.dueDate || null,
        rateBasisPoints: input.rateBasisPoints,
        ratePeriod: input.ratePeriod,
        interestAccountId: interest?.id ?? null,
        notes: input.notes?.trim() || null,
      } as never,
    });
    await postEntry(
      tx,
      { kind: "LEND", date: input.startDate, loanId: loan.id, details: input.details || null },
      lendLines({ money: input.fromAccountId, loan: account.id, interest: interest?.id }, BigInt(input.amount), BigInt(input.upfrontInterest)),
    );
    return loan.id;
  });
}

/** Edits the descriptive details (not the money movements). */
export async function updateLoanDetails(db: UserDb, loanId: string, d: LoanDetails) {
  validateDetails(d);
  return db.$transaction(async (tx) => {
    const loan = await loadLoan(tx, loanId);
    if (d.dueDate && d.dueDate < loan.startDate) throw new LedgerError("The due date can't be before the start date.");
    if (d.interestAccountId) await incomeCategory(tx, d.interestAccountId);
    await tx.loan.update({
      where: { id: loanId },
      data: {
        counterparty: d.counterparty.trim(),
        kind: d.kind,
        dueDate: d.dueDate || null,
        rateBasisPoints: d.rateBasisPoints,
        ratePeriod: d.ratePeriod,
        interestAccountId: d.interestAccountId || null,
        notes: d.notes?.trim() || null,
      },
    });
    await tx.account.update({ where: { id: loan.accountId }, data: { name: accountName(d) } });
  });
}

// ---- Money movements ---------------------------------------------------------

/** Lend more to the same person / add to the same deposit. */
export async function lendMore(
  db: UserDb,
  loanId: string,
  input: { date: string; amount: number; upfrontInterest: number; fromAccountId: string; interestAccountId?: string | null; details?: string | null },
  today: string,
) {
  checkDate(input.date, today);
  checkCents(input.amount, "amount");
  checkCents(input.upfrontInterest, "interest kept up front", true);
  if (input.upfrontInterest >= input.amount) throw new LedgerError("Interest kept up front must be less than the amount.");
  return db.$transaction(async (tx) => {
    const loan = await loadLoan(tx, loanId);
    if (loan.status === "WRITTEN_OFF") throw new LedgerError("This loan was written off. Undo the write-off first.");
    if (input.date < loan.startDate) throw new LedgerError("The date can't be before the loan started.");
    await moneyAccount(tx, input.fromAccountId, "account the money came from");
    const interest = input.upfrontInterest > 0 ? await incomeCategory(tx, input.interestAccountId ?? loan.interestAccountId) : null;
    await postEntry(
      tx,
      { kind: "LEND", date: input.date, loanId, details: input.details || null },
      lendLines({ money: input.fromAccountId, loan: loan.accountId, interest: interest?.id }, BigInt(input.amount), BigInt(input.upfrontInterest)),
    );
    await refreshStatus(tx, loanId);
  });
}

/**
 * Money received back. `principal` comes off what's still out; anything on top
 * is interest. (e.g. receive 104,000 on a 100,000 loan → 100,000 + 4,000.)
 */
export async function receiveBack(
  db: UserDb,
  loanId: string,
  input: { date: string; principal: number; interest: number; intoAccountId: string; interestAccountId?: string | null; details?: string | null },
  today: string,
) {
  checkDate(input.date, today);
  checkCents(input.principal, "principal", true);
  checkCents(input.interest, "interest", true);
  if (input.principal + input.interest === 0) throw new LedgerError("Enter the amount you received.");

  return db.$transaction(async (tx) => {
    const loan = await loadLoan(tx, loanId);
    if (loan.status === "WRITTEN_OFF") throw new LedgerError("This loan was written off. Undo the write-off first.");
    if (input.date < loan.startDate) throw new LedgerError("The date can't be before the loan started.");
    const out = await stillOut(tx, loan);
    if (BigInt(input.principal) > out) {
      throw new LedgerError("That's more than the amount still out. Put the extra under interest.");
    }
    await moneyAccount(tx, input.intoAccountId, "account the money went into");
    const interest = input.interest > 0 ? await incomeCategory(tx, input.interestAccountId ?? loan.interestAccountId) : null;
    await postEntry(
      tx,
      { kind: "LOAN_RETURN", date: input.date, loanId, details: input.details || null },
      returnLines(
        { money: input.intoAccountId, loan: loan.accountId, interest: interest?.id ?? "" },
        BigInt(input.principal),
        BigInt(input.interest),
      ),
    );
    return refreshStatus(tx, loanId);
  });
}

/** The money isn't coming back: what's still out becomes a "Bad debts" expense. */
export async function writeOff(db: UserDb, loanId: string, date: string, today: string, details?: string | null) {
  checkDate(date, today);
  return db.$transaction(async (tx) => {
    const loan = await loadLoan(tx, loanId);
    if (date < loan.startDate) throw new LedgerError("The date can't be before the loan started.");
    const out = await stillOut(tx, loan);
    if (out <= ZERO) throw new LedgerError("Nothing is still out on this loan.");
    const badDebts = await systemAccount(tx, "BAD_DEBTS");
    await postEntry(tx, { kind: "LOAN_WRITE_OFF", date, loanId, details: details || "Written off" }, [
      { accountId: loan.accountId, amount: -out },
      { accountId: badDebts.id, amount: out },
    ]);
    await refreshStatus(tx, loanId);
  });
}

/** Removes one money movement of a loan (lend, money back, write-off, or linked interest). */
export async function deleteLoanMovement(db: UserDb, entryId: string) {
  return db.$transaction(async (tx) => {
    const entry = await tx.entry.findUnique({ where: { id: entryId } });
    if (!entry?.loanId) throw new LedgerError("That entry no longer exists.");
    const lends = await tx.entry.count({ where: { loanId: entry.loanId, kind: "LEND" } });
    if (entry.kind === "LEND" && lends === 1) {
      throw new LedgerError("This is the original lending. Delete the whole loan instead.");
    }
    await tx.entry.delete({ where: { id: entryId } });
    await refreshStatus(tx, entry.loanId);
  });
}

/** Deletes a loan and every money movement recorded on it. Linked interest entries are deleted too. */
export async function deleteLoan(db: UserDb, loanId: string) {
  return db.$transaction(async (tx) => {
    const loan = await loadLoan(tx, loanId);
    await tx.entry.deleteMany({ where: { loanId } });
    await tx.loan.delete({ where: { id: loanId } });
    await tx.account.delete({ where: { id: loan.accountId } });
  });
}

// ---- Reading -----------------------------------------------------------------

type LoanEntry = Awaited<ReturnType<typeof loanEntries>>[number];

function loanEntries(db: UserDb, where: { loanId: string } | { loanId: { in: string[] } }) {
  return db.entry.findMany({
    where,
    include: { lines: { include: { account: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
}

/** Totals for one loan from its entries. `year` ("2026") also totals that year's interest. */
function summarise(loan: Loan, entries: LoanEntry[], year?: string) {
  let lent = ZERO;
  let returned = ZERO;
  let interest = ZERO;
  let interestThisYear = ZERO;
  let writtenOff = ZERO;
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.accountId === loan.accountId) {
        if (e.kind === "LEND") lent += l.amount;
        else if (e.kind === "LOAN_RETURN") returned -= l.amount;
        else if (e.kind === "LOAN_WRITE_OFF") writtenOff -= l.amount;
      } else if (l.account.type === "INCOME") {
        interest -= l.amount;
        if (year && e.date.startsWith(year)) interestThisYear -= l.amount;
      }
    }
  }
  const out = lent - returned - writtenOff;
  return {
    lent,
    returned,
    interest,
    interestThisYear,
    writtenOff,
    out,
    // Interest earned as a % of the money lent (simple, not annualised).
    returnPercent: lent > ZERO ? Number((interest * BigInt(10_000)) / lent) / 100 : 0,
    expected: expectedInterest(lent, loan.rateBasisPoints, loan.ratePeriod, loan.startDate, loan.dueDate),
  };
}

export type LoanSummary = ReturnType<typeof summarise> & { loan: Loan; overdue: boolean; dueSoon: boolean };

/** Every loan with its totals, plus overdue / due-soon flags. */
export async function getLoans(db: UserDb, today: string) {
  const loans = await db.loan.findMany({ orderBy: [{ dueDate: "asc" }, { startDate: "desc" }] });
  const entries = loans.length ? await loanEntries(db, { loanId: { in: loans.map((l) => l.id) } }) : [];
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonIso = soon.toISOString().slice(0, 10);

  return loans.map((loan): LoanSummary => {
    const s = summarise(loan, entries.filter((e) => e.loanId === loan.id), today.slice(0, 4));
    const open = loan.status === "ACTIVE" && s.out > ZERO;
    return {
      ...s,
      loan,
      overdue: open && Boolean(loan.dueDate && loan.dueDate < today),
      dueSoon: open && Boolean(loan.dueDate && loan.dueDate >= today && loan.dueDate <= soonIso),
    };
  });
}

/** One loan with totals and all its money movements (oldest first). */
export async function getLoanDetails(db: UserDb, loanId: string, today: string) {
  const loan = await db.loan.findUnique({ where: { id: loanId } });
  if (!loan) return null;
  const entries = await loanEntries(db, { loanId });
  const s = summarise(loan, entries, today.slice(0, 4));
  const open = loan.status === "ACTIVE" && s.out > ZERO;
  // The very first lending can't be deleted on its own (delete the whole loan instead).
  const lends = entries.filter((e) => e.kind === "LEND");
  const protectedEntryId = lends.length === 1 ? lends[0].id : null;
  return { ...s, loan, entries, protectedEntryId, overdue: open && Boolean(loan.dueDate && loan.dueDate < today) };
}
