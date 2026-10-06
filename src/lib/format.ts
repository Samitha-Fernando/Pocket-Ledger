// Money is always stored as whole cents (integers), never floats.
// Rs 1,250.50 is stored as 125050.

const CURRENCY_SYMBOLS: Record<string, string> = { LKR: "Rs", USD: "$", EUR: "€", GBP: "£", INR: "₹" };

export function currencySymbol(currency: string) {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

/** 125050 → "Rs 1,250.50"; -5000 → "-Rs 50.00" */
export function formatMoney(cents: number | bigint, currency = "LKR") {
  const value = BigInt(cents);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${currencySymbol(currency)} ${whole}.${fraction}`;
}

/**
 * Parses what a person types into cents, without floating-point maths.
 * Accepts "1250", "1,250.5", "Rs 1,250.50". Returns null if not a valid amount.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/rs\.?/i, "").replace(/[,\s]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0");
  const result = Number(sign ? -cents : cents);
  return Number.isSafeInteger(result) ? result : null;
}

/** Date → "dd/MM/yyyy" (local time). */
export function formatDate(date: Date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

/** Date → "dd/MM/yyyy HH:mm" (local time). */
export function formatDateTime(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(date)} ${hh}:${min}`;
}

/** "dd/MM/yyyy" → Date (local midnight), or null if invalid. */
export function parseDate(input: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
