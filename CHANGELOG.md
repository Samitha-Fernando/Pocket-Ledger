# Changelog

All notable changes, in plain English. Newest first.

## Phase 0: Setup (2026-10-06)

### Added
- Project scaffold: Next.js 16 + TypeScript, Tailwind CSS + shadcn/ui, Prisma 7 with SQLite.
- Mobile-first app shell: bottom navigation with a large **+ Add** button on phones,
  sidebar on desktop, light/dark mode. Placeholder screens for Home, Accounts,
  History, Registers and Add (filled in by later phases).
- Multi-user sign-in, built in-house:
  - First-run setup creates the admin account; everyone else needs an invite code.
  - Sign in with email or username + password (argon2 hashed).
  - Quick-unlock PIN (4–6 digits), auto-lock after inactivity (default 10 min).
  - Lock, Switch user (several people on one device), Sign out.
  - Account lockout after 5 wrong passwords (15 min) and per-device rate limiting.
  - Secure, httpOnly cookies. Password change signs out other devices.
- Per-user data isolation: a "scoped" database client automatically limits every
  query to the signed-in user, plus a test that fails if a new table is left unprotected.
- Security activity log per user (shown in Settings).
- Money helpers (stored as whole cents, shown as `Rs 1,250,000.00`) and dd/MM/yyyy dates.
- Installable PWA: manifest, generated app icons, minimal service worker (never
  caches financial pages) and an offline page.
- Demo seed (`npm run seed:demo`, `npm run dev:demo`) using a separate fake database.
- Automated tests (22) for hashing, lockout, PIN rules, money/date formatting and
  user data isolation.
- `.gitignore` blocks databases, `.env`, uploads, backups and all spreadsheet files.
