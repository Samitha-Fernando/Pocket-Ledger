import type { EntryKind } from "@/generated/prisma/client";
import type { UserDb } from "@/lib/db/scoped";
import { isIsoDate, parseMoneyToCents, shiftMonth } from "@/lib/format";
import { monthEnd } from "./assets";
import { type EntryView, describeEntry } from "./describe";

/** Transaction "types" as people think of them, and the entry kinds behind each. */
export const TYPE_GROUPS: Record<string, { label: string; kinds: EntryKind[] }> = {
  income: { label: "Income", kinds: ["INCOME"] },
  expense: { label: "Expense", kinds: ["EXPENSE"] },
  transfer: { label: "Transfer", kinds: ["TRANSFER"] },
  opening: { label: "Starting balance", kinds: ["OPENING_BALANCE"] },
  asset: { label: "Asset", kinds: ["ASSET_PURCHASE", "DEPRECIATION", "ASSET_REVALUATION", "ASSET_SALE"] },
  lending: { label: "Lending", kinds: ["LEND", "LOAN_RETURN", "LOAN_WRITE_OFF"] },
  debt: { label: "Card / loan", kinds: ["BORROW", "DEBT_PAYMENT", "DEBT_CHARGE"] },
};

export const SORTS = { "date-desc": "Newest first", "date-asc": "Oldest first", "amount-desc": "Largest first", "amount-asc": "Smallest first" } as const;
export const GROUPS = { day: "Day", month: "Month", category: "Category" } as const;

export type Filters = {
  from: string;
  to: string;
  types: string[];
  accountId: string;
  categoryId: string;
  min: string;
  max: string;
  q: string;
  batchId: string;
  linked: "" | "asset" | "loan";
  sort: keyof typeof SORTS;
  group: keyof typeof GROUPS;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Reads filters from the page address; defaults to this month, newest first, grouped by day. */
export function parseFilters(params: Record<string, string | string[] | undefined>, today: string): Filters {
  const month = today.slice(0, 7);
  // Old links like /history?month=2026-09 still work.
  const legacyMonth = /^\d{4}-\d{2}$/.test(one(params.month)) ? one(params.month) : "";
  const from = isIsoDate(one(params.from)) ? one(params.from) : legacyMonth ? `${legacyMonth}-01` : params.from === "" || one(params.range) === "all" ? "" : `${month}-01`;
  const to = isIsoDate(one(params.to)) ? one(params.to) : legacyMonth ? monthEnd(legacyMonth) : params.to === "" || one(params.range) === "all" ? "" : monthEnd(month);
  const types = (Array.isArray(params.type) ? params.type : params.type ? [params.type] : []).filter((t) => t in TYPE_GROUPS);
  const sort = one(params.sort) in SORTS ? (one(params.sort) as Filters["sort"]) : "date-desc";
  const group = one(params.group) in GROUPS ? (one(params.group) as Filters["group"]) : "day";
  const linked = one(params.linked) === "asset" || one(params.linked) === "loan" ? (one(params.linked) as Filters["linked"]) : "";
  return {
    from,
    to,
    types,
    accountId: one(params.account),
    categoryId: one(params.category),
    min: one(params.min),
    max: one(params.max),
    q: one(params.q).slice(0, 100),
    batchId: one(params.batch),
    linked,
    sort,
    group,
  };
}

/** Quick date ranges for the filter bar. */
export function quickRanges(today: string) {
  const month = today.slice(0, 7);
  const last = shiftMonth(month, -1);
  const year = today.slice(0, 4);
  return [
    { label: "This month", from: `${month}-01`, to: monthEnd(month) },
    { label: "Last month", from: `${last}-01`, to: monthEnd(last) },
    { label: "This year", from: `${year}-01-01`, to: `${year}-12-31` },
    { label: "All time", from: "", to: "" },
  ];
}

const MAX_RESULTS = 5000;

export type SearchResult = {
  rows: (EntryView & { editable: boolean; size: number; categoryKey: string })[];
  truncated: boolean;
  totals: { count: number; income: number; expenses: number };
};

/** Finds transactions matching the filters (the user-scoped db only ever sees your own). */
export async function searchEntries(db: UserDb, f: Filters): Promise<SearchResult> {
  const kinds = f.types.flatMap((t) => TYPE_GROUPS[t].kinds);
  const min = f.min ? parseMoneyToCents(f.min) : null;
  const max = f.max ? parseMoneyToCents(f.max) : null;
  const amountRange =
    min !== null || max !== null
      ? {
          OR: [
            { amount: { ...(min !== null && { gte: BigInt(min) }), ...(max !== null && { lte: BigInt(max) }) } },
            { amount: { ...(max !== null && { gte: BigInt(-max) }), ...(min !== null && { lte: BigInt(-min) }) } },
          ],
        }
      : null;

  const and: object[] = [];
  if (f.accountId) and.push({ lines: { some: { accountId: f.accountId } } });
  if (f.categoryId) and.push({ lines: { some: { accountId: f.categoryId } } });
  if (amountRange) and.push({ lines: { some: amountRange } });

  const entries = await db.entry.findMany({
    where: {
      ...(f.from || f.to ? { date: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } } : {}),
      ...(kinds.length && { kind: { in: kinds } }),
      // On SQLite "contains" ignores upper/lower case (on PostgreSQL add mode: "insensitive").
      ...(f.q && { details: { contains: f.q } }),
      ...(f.batchId && { importRow: { batchId: f.batchId } }),
      ...(f.linked === "asset" && { assetId: { not: null } }),
      ...(f.linked === "loan" && { loanId: { not: null } }),
      ...(and.length && { AND: and }),
    },
    include: { lines: { include: { account: true } }, asset: { select: { name: true } }, loan: { select: { counterparty: true } } },
    orderBy: [{ date: f.sort === "date-asc" ? "asc" : "desc" }, { createdAt: f.sort === "date-asc" ? "asc" : "desc" }],
    take: MAX_RESULTS + 1,
  });

  const truncated = entries.length > MAX_RESULTS;
  const rows = entries.slice(0, MAX_RESULTS).map((e) => {
    const view = describeEntry(e);
    return {
      ...view,
      // Bulk editing is for everyday income / expenses / transfers; register movements are edited on their own pages.
      editable: (e.kind === "INCOME" || e.kind === "EXPENSE" || e.kind === "TRANSFER") && !e.debtId,
      size: Math.abs(view.amount),
      categoryKey: view.categoryName ?? (view.kind === "TRANSFER" ? "Transfers" : TYPE_LABEL[view.kind] ?? view.kind),
    };
  });
  if (f.sort === "amount-desc") rows.sort((a, b) => b.size - a.size);
  if (f.sort === "amount-asc") rows.sort((a, b) => a.size - b.size);

  const income = rows.reduce((s, e) => s + (e.kind === "INCOME" ? e.amount : (e.interestAmount ?? 0)), 0);
  const expenses = rows.reduce(
    (s, e) =>
      s +
      (e.kind === "EXPENSE" || e.kind === "DEPRECIATION" || e.kind === "LOAN_WRITE_OFF"
        ? e.amount
        : e.kind === "BORROW" || e.kind === "DEBT_PAYMENT" || e.kind === "DEBT_CHARGE"
          ? (e.chargeAmount ?? 0)
          : 0),
    0,
  );
  return { rows, truncated, totals: { count: rows.length, income, expenses } };
}

const TYPE_LABEL: Partial<Record<EntryKind, string>> = Object.fromEntries(
  Object.values(TYPE_GROUPS).flatMap((g) => g.kinds.map((k) => [k, g.label])),
);
