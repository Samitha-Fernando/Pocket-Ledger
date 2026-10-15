/** Kinds of lending / investment and their defaults. Safe to use in the browser. */
export const LOAN_KINDS = {
  CHEQUE_EXCHANGE: { label: "Cheque exchange", ratePeriod: "MONTH", interestCategory: "Cheque Exchange Interest" },
  PERSONAL_LOAN: { label: "Personal loan", ratePeriod: "MONTH", interestCategory: "Other Income" },
  FIXED_DEPOSIT: { label: "Fixed deposit", ratePeriod: "YEAR", interestCategory: "Bank Interest" },
  OTHER: { label: "Other investment", ratePeriod: "YEAR", interestCategory: "Other Income" },
} as const;
export type LoanKind = keyof typeof LOAN_KINDS;

export const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  REPAID: "Repaid",
  WRITTEN_OFF: "Written off",
};
