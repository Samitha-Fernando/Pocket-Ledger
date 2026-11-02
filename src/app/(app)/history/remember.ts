import { cookies } from "next/headers";

/**
 * The History filters each person last used on this device, so "Back", saving or
 * deleting a transaction returns to the same filtered list until they press Reset.
 * Stored as "<userId>|<query string>" in a browser-session cookie (see RememberFilters).
 */
export const HISTORY_COOKIE = "pl_history";

/** Turns page params into a query string, leaving out the given keys. */
export function toQuery(params: Record<string, string | string[] | undefined>, skip: string[] = []) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (skip.includes(k)) continue;
    for (const one of Array.isArray(v) ? v : v !== undefined ? [v] : []) p.append(k, one);
  }
  return p.toString();
}

/** This person's remembered History query ("" if none). */
export async function rememberedHistoryQuery(userId: string) {
  const raw = (await cookies()).get(HISTORY_COOKIE)?.value ?? "";
  const sep = raw.indexOf("|");
  if (sep < 0 || raw.slice(0, sep) !== userId) return "";
  return new URLSearchParams(raw.slice(sep + 1)).toString();
}

/** Where to go back to: the remembered filtered list, else the given month. */
export async function historyHref(userId: string, month?: string) {
  const saved = await rememberedHistoryQuery(userId);
  if (saved) return `/history?${saved}`;
  return month ? `/history?month=${month}` : "/history";
}
