export type FormState = { error?: string; success?: string; needPassword?: boolean } | undefined;

export function field(fd: FormData, name: string) {
  const value = fd.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function checkEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter a valid email address.";
}

/** Username is optional; when given it must be 3–30 of a-z, 0-9, dot, dash, underscore. */
export function checkUsername(username: string): string | null {
  if (!username) return null;
  return /^[a-z0-9._-]{3,30}$/.test(username)
    ? null
    : "Username must be 3–30 characters: letters, numbers, dot, dash or underscore.";
}

export function checkName(name: string): string | null {
  if (!name) return "Enter your name.";
  return name.length > 60 ? "Name is too long." : null;
}
