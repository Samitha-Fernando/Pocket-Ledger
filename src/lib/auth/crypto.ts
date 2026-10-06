import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// argon2id with OWASP-recommended settings (19 MiB memory, 2 passes).
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashSecret(secret: string) {
  return hash(secret, ARGON_OPTIONS);
}

export async function verifySecret(storedHash: string, secret: string) {
  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}

// A real hash of a random value, used to keep timing equal when a login
// names an account that doesn't exist.
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(secret: string) {
  dummyHash ??= hashSecret(randomBytes(16).toString("hex"));
  await verifySecret(await dummyHash, secret);
}

/** Random token for cookies (only its SHA-256 hash is stored in the database). */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Invite codes: no look-alike characters (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newInviteCode() {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `PL-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
