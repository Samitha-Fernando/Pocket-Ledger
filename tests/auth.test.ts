import { describe, expect, it } from "vitest";
import { hashSecret, newInviteCode, normalizeInviteCode, sha256, verifySecret } from "@/lib/auth/crypto";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  afterFailedLogin,
  checkPassword,
  checkPin,
  isAccountLocked,
  isIdleExpired,
} from "@/lib/auth/policy";

describe("password & PIN hashing", () => {
  it("stores an argon2 hash, never the secret itself", async () => {
    const hash = await hashSecret("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery");
  });

  it("verifies the right secret and rejects the wrong one", async () => {
    const hash = await hashSecret("482913");
    expect(await verifySecret(hash, "482913")).toBe(true);
    expect(await verifySecret(hash, "482914")).toBe(false);
  });

  it("treats a corrupt hash as a failed check (no crash)", async () => {
    expect(await verifySecret("not-a-hash", "x")).toBe(false);
  });
});

describe("account lockout", () => {
  it(`locks for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} failures`, () => {
    const now = new Date("2026-01-01T10:00:00Z");
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      state = afterFailedLogin(state.failedLoginCount, now);
      expect(state.lockedUntil).toBeNull();
    }
    state = afterFailedLogin(state.failedLoginCount, now);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + LOCKOUT_MINUTES * 60_000);
    expect(isAccountLocked(state.lockedUntil, now)).toBe(true);
    expect(isAccountLocked(state.lockedUntil, new Date(now.getTime() + (LOCKOUT_MINUTES + 1) * 60_000))).toBe(false);
  });
});

describe("auto-lock", () => {
  it("expires a session idle longer than the setting", () => {
    const last = new Date("2026-01-01T10:00:00Z");
    expect(isIdleExpired(last, 10, new Date("2026-01-01T10:09:59Z"))).toBe(false);
    expect(isIdleExpired(last, 10, new Date("2026-01-01T10:10:01Z"))).toBe(true);
  });
});

describe("PIN and password rules", () => {
  it("accepts 4–6 digit PINs that aren't trivial", () => {
    expect(checkPin("4829")).toBeNull();
    expect(checkPin("482913")).toBeNull();
  });

  it("rejects bad PINs", () => {
    expect(checkPin("123")).not.toBeNull();
    expect(checkPin("1234567")).not.toBeNull();
    expect(checkPin("12a4")).not.toBeNull();
    expect(checkPin("0000")).not.toBeNull();
    expect(checkPin("1234")).not.toBeNull();
    expect(checkPin("6543")).not.toBeNull();
  });

  it("requires passwords of at least 8 characters", () => {
    expect(checkPassword("short")).not.toBeNull();
    expect(checkPassword("long enough")).toBeNull();
  });
});

describe("invite codes", () => {
  it("look like PL-XXXX-XXXX-XXXX and avoid look-alike characters", () => {
    const code = newInviteCode();
    expect(code).toMatch(/^PL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code.slice(3)).not.toMatch(/[01OIL]/);
  });

  it("match regardless of case and spaces", () => {
    expect(sha256(normalizeInviteCode(" pl-abcd-efgh-jkmn "))).toBe(sha256("PL-ABCD-EFGH-JKMN"));
  });
});
