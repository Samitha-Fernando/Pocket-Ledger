"use client";

import { useEffect, useRef } from "react";

const CHECK_EVERY_MS = 15_000;
const HEARTBEAT_EVERY_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;

/**
 * Locks the app after `minutes` without activity. While the person is active,
 * it tells the server every minute so the server-side lock timer stays in step.
 */
export function IdleLock({ minutes }: { minutes: number }) {
  const lastActivity = useRef(0);
  const lastHeartbeat = useRef(0);

  useEffect(() => {
    const now = Date.now();
    lastActivity.current = now;
    lastHeartbeat.current = now;
    const limit = minutes * 60_000;

    // A full page load (not client navigation) so no financial data stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    const goToLock = () => window.location.assign("/lock");

    const lockNow = async () => {
      await fetch("/api/session/lock", { method: "POST" }).catch(() => {});
      goToLock();
    };

    const check = async () => {
      const t = Date.now();
      if (t - lastActivity.current > limit) return lockNow();
      // Activity since the last heartbeat? Keep the server session alive.
      if (lastActivity.current > lastHeartbeat.current && t - lastHeartbeat.current > HEARTBEAT_EVERY_MS) {
        lastHeartbeat.current = t;
        const res = await fetch("/api/session/heartbeat", { method: "POST" }).catch(() => null);
        if (res && res.status === 401) goToLock();
      }
    };

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    // Phones pause timers in the background; check as soon as the app is visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [minutes]);

  return null;
}
