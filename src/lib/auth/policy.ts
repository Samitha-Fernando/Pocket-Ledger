// Security rules in one place, so they're easy to read and to test.

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const MAX_FAILED_PINS = 5;
export const IP_ATTEMPT_LIMIT = 20; // failed attempts per IP...
export const IP_WINDOW_MINUTES = 15; // ...within this window
export const SESSION_DAYS = 30; // how long a device stays remembered
export const INVITE_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 8;
export const AUTO_LOCK_MIN = 1;
export const AUTO_LOCK_MAX = 120;

const minutes = (n: number) => n * 60_000;

/** After a failed password, returns the new counter and lock time (if any). */
export function afterFailedLogin(failedCount: number, now = new Date()) {
  const count = failedCount + 1;
  return {
    failedLoginCount: count,
    lockedUntil: count >= MAX_FAILED_LOGINS ? new Date(now.getTime() + minutes(LOCKOUT_MINUTES)) : null,
  };
}

export function isAccountLocked(lockedUntil: Date | null, now = new Date()) {
  return lockedUntil !== null && lockedUntil > now;
}

/** True when the session has been idle longer than the user's auto-lock time. */
export function isIdleExpired(lastActiveAt: Date, autoLockMinutes: number, now = new Date()) {
  return now.getTime() - lastActiveAt.getTime() > minutes(autoLockMinutes);
}

/** Returns an error message, or null if the PIN is acceptable. */
export function checkPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN must be 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin)) return "PIN can't be the same digit repeated.";
  const digits = pin.split("").map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return "PIN can't be a simple sequence like 1234.";
  }
  return null;
}

export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 128) return "Password is too long.";
  return null;
}
