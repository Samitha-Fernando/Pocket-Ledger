# Pocket Ledger

A personal finance and net-worth tracker. It tracks income, expenses, cash, bank and
savings balances, assets, money lent or invested, and debts, and shows your real net
worth at any point in time.

Under the hood every transaction is **double-entry**: money always moves *from* one
account *to* another, so balances always reconcile. You never have to think in
debits and credits; you fill in a simple form and the app records both sides.

> Status: **Phase 2 (assets)** is complete. See [CHANGELOG.md](CHANGELOG.md) and the
> full plan in [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md).

---

## Running it on your laptop

You need **Node.js 20+** installed.

```bash
npm install          # first time only: downloads the libraries
npm run db:deploy    # first time only: creates your database in ./data
npm run dev          # starts the app
```

Then open **http://localhost:3000**. The very first time, it asks you to create the
**admin** account (that's you).

### Recording videos with fake data

When the app runs on the demo database, a yellow **DEMO DATA** strip shows at the
top of every screen, so you always know which one you're in.

Your real database is `data/pocket-ledger.db`. For videos, use a separate demo
database full of made-up people:

```bash
npm run seed:demo    # (re)builds data/demo.db with fake users
npm run dev:demo     # runs the app on the demo database
```

Demo logins (all fake):

| Name | Email | Username | Password | PIN |
|---|---|---|---|---|
| Nimal Perera (admin) | nimal@demo.test | nimal | demo-pass-1 | 2580 |
| Kumari Perera | kumari@demo.test | kumari | demo-pass-2 | 1470 |

### Other useful commands

| Command | What it does |
|---|---|
| `npm test` | Runs the automated tests (uses its own throw-away database) |
| `npm run typecheck` | Checks the code for type mistakes |
| `npm run lint` | Checks code style |
| `npm run build` | Makes a production build (the way it would run on a server) |
| `npm run db:studio` | Opens a viewer for the database |
| `npm run check:ledger` | Health check: confirms every transaction balances and lists balances (`npm run check:ledger -- demo` for the demo database) |
| `npm run db:migrate` | After pulling new code: updates your database to the latest design |

---

## How the money works

- **Accounts** are anything money sits in or flows through: *your money* (cash,
  bank, savings), *income categories* and *expense categories*. You start with a
  ready-made list and can add, rename, reorder and archive. Used accounts can't be
  deleted (so history stays complete); unused ones can.
- **Every transaction has two sides that add up to zero.** A Rs 5,000 grocery
  expense paid in cash is stored as *Cash in hand −5,000* and *Groceries +5,000*.
  The app refuses to save anything that doesn't balance.
- **Balances are never typed in.** They are always the sum of the transactions.
  A starting balance is recorded as a transaction from the behind-the-scenes
  *Opening Balances* account.
- **Transfers aren't expenses.** Moving money to savings changes where it is,
  not how much you have, so your net worth stays the same.
- Amounts are stored as whole cents, so there are no rounding errors.

## Assets (things you own that keep their value)

- **Asset or expense is your choice per purchase.** On the Expense form, switch on
  **"Record as asset?"**. It switches on by itself for Rs 50,000 or more (change
  the amount in Settings), and you can always switch it off.
- Buying an asset moves money from your account into the asset, so your **net
  worth doesn't drop** on the day you buy it.
- **Depreciation**: each month the asset loses an equal share of (price − leftover
  value) over its useful life, starting the month you buy it. It's posted on the
  last day of each month as a "Depreciation" expense, automatically, whenever you
  open the app. Default lives: Vehicles 8 yrs, Electronics & phones 3, Computers 4,
  Furniture 7, Other 5 (change per asset; 0 = doesn't lose value).
- **Change value** (e.g. after damage), **sell** or **scrap** from the asset's page.
  Differences are recorded as "Gain on assets" / "Loss on assets".
- **Link repairs** to an asset to see the **true cost of owning it**: price +
  repairs − what it's worth now.
- Changed your mind? Convert an expense to an asset (edit it in History and switch
  on "Record as asset?") or an asset back to an expense (on its page).
- Photos are stored in the `uploads/` folder (never committed) and only the owner
  can see them.

## How sign-in and privacy work

- **Separate data per person.** Each person has their own login and sees only their
  own data. This is enforced on the server: feature code reads the database through a
  "scoped" client that automatically adds *only this user's records* to every query.
  A test proves user A can't read or change user B's data.
- **Invite-only.** After the admin account exists, new people need an **invite
  code** (Settings → Invites). Codes work once and expire after 7 days.
- **Passwords and PINs are never stored**, only argon2 hashes, a one-way
  scramble that even someone who copies the database can't reverse.
- **Lockout.** 5 wrong passwords lock the account for 15 minutes. Too many failed
  attempts from one device are also blocked.
- **Quick unlock with a PIN.** After signing in once on a device you can set a 4–6
  digit PIN. 5 wrong PINs means you must use your password.
- **Auto-lock.** The app locks after 10 minutes without use (change it in Settings).
- **Lock / Switch user.** *Lock* shows the PIN screen. *Switch user* shows everyone
  signed in on this device (e.g. husband and wife on one computer), and each person
  unlocks with their own PIN. *Sign out* forgets the login on this device.
- Cookies are `httpOnly` (page scripts can't read them) and become `secure`
  (HTTPS-only) automatically when `APP_URL` starts with `https://`.

## Install it like an app (PWA)

In production mode (`npm run build` then `npm start`), Chrome or Edge shows an
**Install** icon in the address bar. On a phone, use **Add to Home screen**. (Phone
install needs the app hosted with HTTPS, which comes in Phase 8.)

## What is kept out of GitHub

`.gitignore` blocks: the `data/` folder (all databases), `.env`, uploads, backups,
exports, and **every** `.xlsx`, `.xls` and `.csv` file, so your real budget file can't
be committed by accident.

## Tech used

Next.js 16 (App Router) + TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma 7 with
SQLite (PostgreSQL later) · argon2 password hashing · Vitest for tests.

## Project layout

```
prisma/schema.prisma      database design
src/app/(auth)/           sign-in, setup, register, lock, switch-user screens
src/app/(app)/            the app itself (home, accounts, history, registers, settings)
src/lib/auth/             sign-in, sessions, PIN, lockout rules
src/lib/db/               database client + the per-user "scoped" client
src/lib/format.ts         money (stored as whole cents) and dd/MM/yyyy dates
tests/                    automated tests
scripts/seed-demo.ts      fake demo data
```
