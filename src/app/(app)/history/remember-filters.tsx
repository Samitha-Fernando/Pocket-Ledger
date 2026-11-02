"use client";

import { useEffect } from "react";

/** Saves the current History filters (or clears them) for this browser session. */
export function RememberFilters({ name, value }: { name: string; value: string | null }) {
  useEffect(() => {
    document.cookie = value
      ? `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`
      : `${name}=; path=/; max-age=0; SameSite=Lax`;
  }, [name, value]);
  return null;
}
