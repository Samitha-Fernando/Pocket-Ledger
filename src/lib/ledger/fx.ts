/**
 * Foreign-currency maths (e.g. a USD account for someone whose books are in LKR). Pure.
 *
 * Every line keeps `amount` in the user's own currency, so the books always balance in one
 * currency. Lines of a foreign account also keep `foreignAmount` (in that currency). A rate is
 * stored as rate4 = "how many of the user's currency one foreign unit buys" × 10,000.
 */

const ZERO = BigInt(0);
const RATE_SCALE = BigInt(10_000);

/** "300.25" → 3002500n; null if not a positive number with at most 4 decimals. */
export function parseRate(text: string | null | undefined): bigint | null {
  const t = (text ?? "").replace(/[,\s]/g, "");
  const m = /^(\d{1,7})(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) return null;
  const rate = BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? "").padEnd(4, "0"));
  return rate > ZERO ? rate : null;
}

/** 3002500n → "300.25" (trailing zeros dropped). */
export function formatRate(rate4: bigint) {
  const whole = rate4 / RATE_SCALE;
  const frac = (rate4 % RATE_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Divides and rounds half away from zero. */
function divRound(n: bigint, d: bigint) {
  const neg = n < ZERO !== d < ZERO;
  const a = n < ZERO ? -n : n;
  const b = d < ZERO ? -d : d;
  const q = (a * BigInt(2) + b) / (b * BigInt(2));
  return neg ? -q : q;
}

/** Foreign cents → the user's cents at a rate (e.g. $2,000.00 at 300 → Rs 600,000.00). */
export function toBase(foreignCents: bigint, rate4: bigint) {
  return divRound(foreignCents * rate4, RATE_SCALE);
}

/** The rate implied by two amounts (Rs received ÷ $ sent), as rate4. */
export function impliedRate(baseCents: bigint, foreignCents: bigint) {
  if (foreignCents === ZERO) return ZERO;
  return divRound(baseCents * RATE_SCALE, foreignCents);
}

/**
 * What the dollars being spent or converted had cost, in the user's currency, at the
 * average rate of the dollars held (average cost). Anything spent beyond what's held is
 * valued at `rate4`, the rate of this transaction.
 */
export function bookValueOut(held: { book: bigint; foreign: bigint }, foreignOut: bigint, rate4: bigint) {
  if (held.foreign <= ZERO) return toBase(foreignOut, rate4);
  const fromHeld = foreignOut < held.foreign ? foreignOut : held.foreign;
  const covered = divRound(held.book * fromHeld, held.foreign);
  return covered + (foreignOut > fromHeld ? toBase(foreignOut - fromHeld, rate4) : ZERO);
}

export type Rate = { currency: string; date: string; rate4: bigint };

/** The latest rate for a currency on or before a date (rates sorted any way). */
export function rateOn(rates: Rate[], currency: string, date: string) {
  let best: Rate | null = null;
  for (const r of rates) if (r.currency === currency && r.date <= date && (!best || r.date > best.date)) best = r;
  return best;
}
