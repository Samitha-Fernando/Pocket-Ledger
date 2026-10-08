# Changelog

All notable changes, in plain English. Newest first.

## Phase 2: Assets (2026-10-08)

### Added
- **"Record as asset?" switch** on the Expense form. It turns on automatically for
  Rs 50,000 or more (changeable in Settings), with a hint, and can always be switched
  off, or on for cheaper items. Extra fields: name, asset class, useful life, leftover
  value, notes, optional photo.
- **Asset register** (Registers → Assets): list with value today and price paid;
  a page per asset with value, depreciation so far, repairs, **true cost of owning
  it**, notes, photo and a month-by-month depreciation schedule (posted + planned).
- **Automatic monthly depreciation** (straight-line, from the purchase month, posted
  on the last day of each month). Fills in missed months whenever you open the app;
  never posts twice; lands exactly on the leftover value at the end of life.
- **Change value** (posts Gain/Loss on assets and re-spreads the rest of the life),
  **sell**, **scrap / give away**, **undo sale**, **edit details** (re-calculates
  depreciation).
- **Link repairs** and upkeep expenses to an asset.
- **Convert** an expense into an asset (edit it in History, switch on "Record as
  asset?") and an asset back into an expense.
- New app-managed categories, added automatically for every user: Depreciation,
  Gain on assets, Loss on assets.
- Asset photos (JPG/PNG/WebP up to 5 MB) stored in `uploads/`, only viewable by the
  owner, never cached by the browser.
- Yellow **DEMO DATA** banner whenever the app runs on the demo database.
- Demo users now own a scooter, phone and laptop with linked repairs.
- 23 new tests (62 total) covering the depreciation maths, purchases, value changes,
  sales, conversions, repairs and privacy.

### Changed
- Home: real **Fixed assets** tile; net worth includes assets at today's value.
- Accounts: new "Fixed assets (worth now)" group; "Your money" lists only cash,
  bank and savings.
- History: shows asset purchases, depreciation, value changes and sales; monthly
  expenses include depreciation. Asset entries open their asset's page.
- Editing a transaction keeps its original "added" time.

## Phase 1: Accounts & core transactions (2026-10-06)

### Added
- **Double-entry engine**: every transaction is saved as lines that add up to zero;
  anything unbalanced is refused. Balances are always calculated, never typed in.
- **Starting list of accounts** for every user: Cash in hand, Bank account, Savings
  account, AIA Emergency Fund, 5 income categories, 14 expense categories, plus a
  behind-the-scenes Opening Balances account.
- **Accounts screen**: your money with live balances, this month's income and
  expenses per category, archived accounts. Tapping an account shows its
  transactions with a running balance.
- **Add / edit accounts**: add an account or category (with an optional starting
  balance), rename, move up/down, archive/unarchive, delete if never used.
- **Add transaction**: Expense, Income and Transfer tabs; big amount box with
  thousands separators; category chips; remembers the account you used last time;
  warns (but allows) when an account would go below zero.
- **History screen**: month by month, grouped by day, with income/expense totals.
  Tap any transaction to edit or delete it.
- **Home screen**: real net worth, cash & bank, savings, and this month's income and
  expenses.
- Activity log now records added/edited/deleted transactions and account changes.
- `npm run check:ledger`: a health check that every transaction balances.
- Demo seed now creates ~100 realistic fake transactions per demo user.
- 17 new tests (39 total): every form balances, balances add up, edit/delete update
  balances, bad amounts/dates rejected, wrong account types rejected, can't post to
  or change another user's data, archived accounts blocked for new entries.

### Changed
- Each user now has a time zone setting (default Asia/Colombo) so "today" is right
  even when the app is hosted elsewhere later.

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
