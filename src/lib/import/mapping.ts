/**
 * How each spreadsheet "Type / Category" becomes a transaction in the app.
 * Pure functions: no database.
 */

export type Target =
  | { action: "EXPENSE"; targetId: string } // expense category
  | { action: "INCOME"; targetId: string } // income category
  | { action: "TRANSFER"; targetId: string } // savings account the money moved to
  | { action: "DEBT_PAYMENT"; targetId: string } // card / loan the payment went to
  | { action: "ASSET_RULE"; targetId: string } // big purchases → asset, smaller → this expense category
  | { action: "SKIP" }
  | { action: "REVIEW" }; // decide row by row

export type Mapping = Record<string, Target>;

export type AccountLite = { id: string; name: string; type: string; subtype: string | null; isSystem: boolean; archived: boolean };

export const mappingKey = (type: string, category: string) => `${type} / ${category}`;

/** "Fun & vacation" ≈ "Fun & Vacation"; "Assets Repairs and maintenance" ≈ "Assets Repairs & Maintenance". */
export function normalise(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Spreadsheet categories that don't match by name but have an obvious home. */
const KNOWN: Record<string, string> = {
  [normalise("Emergency Fund (AIA Insurance)")]: "AIA Emergency Fund",
  [normalise("Wire nail selling")]: "Side Sales",
};

function findByName(accounts: AccountLite[], name: string, filter: (a: AccountLite) => boolean) {
  const n = normalise(name);
  const wanted = KNOWN[n] ? normalise(KNOWN[n]) : n;
  const pool = accounts.filter((a) => filter(a) && !a.isSystem && !a.archived);
  return pool.find((a) => normalise(a.name) === wanted) ?? pool.find((a) => normalise(a.name).includes(wanted) || wanted.includes(normalise(a.name)));
}

const isMoney = (a: AccountLite) => a.type === "ASSET" && !["FIXED", "LENT"].includes(a.subtype ?? "");

/** Sensible first guess for one "Type / Category". */
export function defaultTarget(type: string, category: string, accounts: AccountLite[]): Target {
  const t = type.toLowerCase();
  const c = normalise(category);

  if (t.startsWith("income")) {
    const cat = findByName(accounts, category, (a) => a.type === "INCOME");
    return cat ? { action: "INCOME", targetId: cat.id } : { action: "REVIEW" };
  }
  if (t.startsWith("saving")) {
    const acc = findByName(accounts, category, isMoney);
    return acc ? { action: "TRANSFER", targetId: acc.id } : { action: "REVIEW" };
  }
  // Expenses
  if (c === "debt") return { action: "REVIEW" }; // you choose which card / loan
  if (c === "asset purchases" || c === "asset purchase") {
    const fallback = findByName(accounts, "Other", (a) => a.type === "EXPENSE");
    return fallback ? { action: "ASSET_RULE", targetId: fallback.id } : { action: "REVIEW" };
  }
  const cat = findByName(accounts, category, (a) => a.type === "EXPENSE");
  return cat ? { action: "EXPENSE", targetId: cat.id } : { action: "REVIEW" };
}

export function defaultMapping(keys: { type: string; category: string }[], accounts: AccountLite[]): Mapping {
  return Object.fromEntries(keys.map((k) => [mappingKey(k.type, k.category), defaultTarget(k.type, k.category, accounts)]));
}

export type RowPlan = {
  action: string;
  targetId: string | null;
  note: string | null;
  assetName?: string | null;
};

/** What one row will become, given the mapping. */
export function planRow(
  row: { date: string | null; type: string; category: string; amount: bigint | number | null; details: string | null },
  mapping: Mapping,
  assetThresholdCents: number,
): RowPlan {
  if (!row.date) return { action: "REVIEW", targetId: null, note: "The date couldn't be read." };
  if (row.amount === null || row.amount === undefined) return { action: "REVIEW", targetId: null, note: "The amount is blank." };
  if (Number(row.amount) <= 0) return { action: "REVIEW", targetId: null, note: "The amount is zero or negative." };

  const target = mapping[mappingKey(row.type, row.category)] ?? { action: "REVIEW" };
  switch (target.action) {
    case "SKIP":
      return { action: "SKIP", targetId: null, note: null };
    case "REVIEW":
      return {
        action: "REVIEW",
        targetId: null,
        note: normalise(row.category) === "debt" ? "Choose the card or loan this paid, or keep it as an expense." : "Choose what this should be.",
      };
    case "ASSET_RULE":
      return Number(row.amount) >= assetThresholdCents
        ? { action: "ASSET", targetId: null, note: null, assetName: row.details?.slice(0, 80) || row.category }
        : { action: "EXPENSE", targetId: target.targetId, note: null };
    default:
      return { action: target.action, targetId: target.targetId, note: null };
  }
}

/** "EXPENSE:abc" ↔ Target, for <select> values. */
export function encodeTarget(t: Target) {
  return "targetId" in t ? `${t.action}:${t.targetId}` : t.action;
}

export function decodeTarget(value: string): Target | null {
  const [action, targetId] = value.split(":");
  if (action === "SKIP" || action === "REVIEW") return { action };
  if (["EXPENSE", "INCOME", "TRANSFER", "DEBT_PAYMENT", "ASSET_RULE"].includes(action) && targetId) {
    return { action: action as "EXPENSE", targetId };
  }
  return null;
}
