/** Kinds of debt and their defaults. Safe to use in the browser. */
export const DEBT_KINDS = {
  CREDIT_CARD: { label: "Credit card", isCard: true },
  PAWNING: { label: "Pawning", isCard: false },
  BANK_LOAN: { label: "Bank / personal loan", isCard: false },
  LEASE: { label: "Lease", isCard: false },
  OTHER: { label: "Other debt", isCard: false },
} as const;
export type DebtKind = keyof typeof DEBT_KINDS;

export const DEBT_STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", PAID_OFF: "Paid off" };

/** How many days ahead a payment counts as "due soon". */
export const DUE_SOON_DAYS = 7;
