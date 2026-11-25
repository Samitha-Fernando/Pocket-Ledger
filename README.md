# Pocket Ledger

A personal finance and net-worth tracker. It tracks income, expenses, cash, bank and
savings balances, assets, money lent or invested, and debts, and shows your real net
worth at any point in time.

Under the hood every transaction is **double-entry**: money always moves *from* one
account *to* another, so balances always reconcile. You never have to think in
debits and credits; you fill in a simple form and the app records both sides.

> Status: **Phase 8 (run it on your laptop)** is complete. Hosting on a server comes later,
> when you're ready. See [CHANGELOG.md](CHANGELOG.md) and the full plan in
> [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md).

---

## Daily use: the desktop icon

You don't need a server. Pocket Ledger runs on this laptop and only this laptop can
open it.

- **Double-click "Pocket Ledger" on the Desktop.** It starts quietly in the background
  and opens in its own window (Edge or Chrome "app mode", no address bar). The first
  click after switching on the laptop takes about 10–20 seconds; after that it's
  instant. Clicking the icon again while it's running just opens another window.
- Closing the window doesn't stop it (it uses very little memory). To stop it fully:
  **Start menu → Pocket Ledger → Stop Pocket Ledger**. Restarting the laptop stops it too.
- The Start menu folder also has **Update Pocket Ledger** (after new features are
  added: it backs up, installs, updates the database and rebuilds, in a window that
  shows progress) and **Back up Pocket Ledger now**.
- Icons missing (e.g. a new laptop)? Run `npm run app:shortcuts` once.
- If something goes wrong, details are in `data/app.log` and `data/launcher.log`.

### Backups

- **Automatic, once a day:** the first time you open the app each day it saves a full
  copy (database + asset photos) in the `backups/` folder. The newest 30 are kept.
  Updates also make a backup first.
- **Google Drive copy:** install *Google Drive for desktop*, sign in, then in
  **Settings → Backups on this computer** enter `G:My Drive` (or wherever "My Drive"
  appears in File Explorer). Every backup is then also copied to
  *My Drive → Pocket Ledger backups*, so it survives a lost or broken laptop.
- **Restoring a full backup** (everyone's data, e.g. on a new laptop): stop Pocket
  Ledger, then copy `pocket-ledger.db` from the backup folder over
  `data/pocket-ledger.db`, and its `uploads` folder over `uploads/`. Start it again.

### Your data (Settings → Your data)

Each person can download their own data at any time:
- **Export to Excel**: transactions, accounts, assets, lending, cards & loans and budgets
  on separate sheets. **CSV**: just the transactions.
- **Download my backup**: a single file with everything of yours (incl. photos).
  It can be restored into an **empty** account, for example after moving to a server.

Also in Settings: **Currency** (only changes the symbol; amounts aren't converted) and,
for the admin, **People**: disable someone so they can't sign in (their data stays
private and untouched) or enable them again.

## Running it for development

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
| `npm run backup` | Makes a full backup now (same as the Start menu item) |
| `npm run app:start` / `app:stop` / `app:update` | What the desktop and Start menu icons run |
| `npm run app:shortcuts` | (Re)creates the desktop and Start menu icons |

---

## Colours

Each kind of money has one colour everywhere in the app: **your money** teal, **savings**
blue, **money you owe** red, **lent out** violet, **assets** amber, **income** green,
**expenses** rose. They're calm, slightly muted shades with separate versions for day and
night mode. Home, Accounts and Budgets use the whole width of large screens.

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

## Lending & investments

- **Registers → Lending & investments → Lend** records money you lend or invest:
  cheque exchanges, personal loans, fixed deposits, other investments.
- **Interest kept up front**: if you deduct your interest before handing over the
  money (e.g. lend Rs 100,000 at 4%, hand over Rs 96,000), enter the 4,000 in
  "Interest kept up front". The loan is recorded at 100,000, only 96,000 leaves
  your account, and the 4,000 counts as interest earned that day.
- **Money received**: enter the total you got back. The app pays off the loan first
  and treats anything extra as interest (e.g. 104,000 on a 100,000 loan → 4,000
  interest). You can change the split. When everything is back, the loan is
  marked **Repaid** automatically.
- Interest paid separately (e.g. monthly fixed-deposit interest) can be recorded with
  the normal Income form: choose the loan under "From a loan or investment?".
- **Write off** money that isn't coming back; it becomes a "Bad debts" expense.
  Delete the write-off later if they do pay.
- The register shows money out now, interest earned this year and all-time, the
  overall return, **overdue** loans (in red) and those **due in the next 30 days**.
  Home shows a warning when something is overdue.
- Rates can be per month (default for cheque exchange) or per year (fixed deposits).

## Credit cards & loans you owe

- **Registers → Credit cards & loans → Add** a credit card, pawning, bank/personal
  loan, lease or other debt. If you already owe something on it, enter the balance;
  for a new loan, record what you borrowed (and any **fees deducted**, which count
  as an expense).
- **Pay with your card**: credit cards appear under "Paid from" on the Expense form
  and when buying an asset. The spending is counted as an expense, and what you owe
  on the card goes up. A warning shows if it's more than the credit left.
- **Make a payment** on the card or loan's page: enter what you paid. Paying off what
  you owe is **not** an expense (the spending was already counted); only the
  **interest** is. For loans the app suggests this month's interest (from the rate)
  and you can change the split. Loans are marked **Paid off** at zero; cards stay open.
- **Interest or fees charged** (e.g. from a card statement) are an expense and are
  added to what you owe. **Borrow more** / **cash advance** adds to the debt.
- Set a **payment due day** to get reminders: "Due in the next 7 days", and
  "Payment missed" if a due date passes with nothing paid. Home shows a warning.
- **Net worth** = what you own − what you owe.

## Importing your Excel history

**History → Import** (or Settings → Import), then upload your `.xlsx`:

1. **Categories**: choose the account the sheet tracked (e.g. Bank account), the
   balance before the first row (0 if the first row was your first money in), and
   what each spreadsheet "Type / Category" becomes. Sensible guesses are filled in:
   Savings rows become **transfers** (not expenses), "Asset Purchases" of Rs 50,000+
   become **assets**, "Debt" rows wait for you to pick the card/loan (or an expense).
   The sheet's "late income shift" setting can be copied to your settings.
2. **Review rows**: filter to "Needs a decision", search, change rows one by one or
   select many and change them together; skip rows you don't want.
3. **Post**: shows the spreadsheet total vs the posted total per category (✓ when
   they match). Every transaction keeps its original spreadsheet row, shown on its
   page in History.

- The file is read once and **not kept**; nothing is posted until you press Post.
- **Upload a newer version later** and only the new rows are added.
- **Undo** removes everything an import created (including assets it bought).
- Uses SheetJS 0.20.3 from its official site (the npm copy is outdated).

## History workbench

- **Find anything**: quick ranges (this month, last month, this year, all time) or
  your own dates; search the details; filter by type, account, category, amount,
  import, or "linked to an asset / loan"; sort by date or amount; group by day, month
  or category. Totals update with the filters, and the filters live in the page
  address (bookmark them).
- **Fix many at once**: tick transactions (or "select all"), then change category or
  account, link to an asset or loan, convert expenses to assets / transfers / card or
  loan payments, or delete. Asset, lending and card/loan movements are changed on
  their own pages, so they can't be ticked.
- **Rules** (History → Rules): "if the details contain *TW* → link to asset *Bike*"
  (and/or set category / account / loan). See how many past transactions a rule would
  change, then apply it. On the Add form, matching rules are **suggested** with an
  Apply button; they're never applied without you.
- **Edit history**: every transaction page shows what changed, when and how (added,
  edited, bulk change, rule, import, undo), with before → after. Settings lists
  recently deleted transactions.

## Dashboard (Home)

- **Period**: this month (default), last month, this year, last 12 months, or your
  own dates. Trend charts show the 12 months up to the end of the period.
- **Net worth** now, its change over the period, and a 12-month trend.
- **Where your money is**: cash, bank, savings, lent out & invested, fixed assets
  (today's value) and debts.
- **Income vs expenses** by month, with period totals. Expenses include depreciation
  (shown separately), the real cost of things wearing out.
- **Savings rate**: **Kept** = (income − expenses) ÷ income, and **Moved to savings**
  = transfers into savings accounts ÷ income (like the spreadsheet).
- **Top expenses** with % of spending and change vs the period before; tap one to
  see those transactions in History.
- **Coming up**: money due back to you and card/loan payments due in the next 30
  days, overdue first.
- **Late income shift** (Settings): income on or after day N counts toward the next
  month in these reports only.

## Budgets

**Registers → Budgets** (also from the Budget card on Home).

- **Plan**: one year at a time, laid out like the "Budget Planning" sheet: Income,
  Expenses and Savings down the side, months across, totals and **To be allocated**
  (income − expenses − savings). On a phone it shows one month at a time.
  Type in a cell and it saves when you leave it. ↻ = same amount every month;
  the copy icon on a month copies the previous month into it; "Copy <last year>"
  starts a year from the one before.
- Budget lines: every income and expense category, each savings account, plus two
  special lines like the sheet: **Asset purchases** (what you paid for assets) and
  **Debt payments** (what you paid off cards and loans; their interest counts under
  its expense category).
- **Budget vs actual**: pick a month or the whole year to see actual vs planned for
  every line, with a green / amber (90%+) / red (over) bar. Income uses the late
  income shift.
- **Import from Excel**: upload your spreadsheet; the "Budget Planning" sheet is read
  (all year blocks), you choose where each line goes (sensible matches are filled in,
  "Debt" → Debt payments, "Asset Purchases" → Asset purchases), then save. Months
  already budgeted are replaced for the lines you import, after a warning.

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
install needs the app hosted with HTTPS, which comes when it moves to a server.)

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
src/lib/backup/           daily whole-app backups (+ Google Drive copy)
src/lib/export/           Excel/CSV export, personal backup and restore
scripts/app.ts            desktop launcher: start, stop, update, shortcuts
scripts/windows/          what the desktop / Start menu icons run
src/lib/format.ts         money (stored as whole cents) and dd/MM/yyyy dates
tests/                    automated tests
scripts/seed-demo.ts      fake demo data
```
