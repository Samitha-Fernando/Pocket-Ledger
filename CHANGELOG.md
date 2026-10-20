# Changelog

All notable changes, in plain English. Newest first.

## Phase 6: Dashboard & reports (2026-10-20)

### Added
- **Home is now a dashboard** with a period selector (this month, last month, this
  year, last 12 months, custom dates).
- **Net worth** now, change over the period, and a 12-month trend chart.
- **Where your money is**: cash, bank, savings, lent out & invested, fixed assets and
  debts, with share bars.
- **Income vs expenses**: period totals (expenses incl. depreciation, shown
  separately), money left over, and a 12-month bar chart.
- **Savings rate**: "Kept" (income − expenses ÷ income) as the headline and "Moved to
  savings" (like the spreadsheet), with a 12-month trend.
- **Top expenses**: top 8 categories with % of spending and change vs the previous
  period; each opens History filtered to it.
- **Coming up**: loans due back and card/loan payments due in the next 30 days,
  overdue first.
- **Late income shift** applied in reports (income on/after day N counts next month).
- Recharts 3.10.1 for charts; chart colours follow light/dark mode.
- Demo: Kumari has the late income shift on (day 25).
- 9 new tests (133 total): periods, late income shift (incl. the day-N edge), flows,
  both savings rates, net worth (incl. assets at book value and debts), monthly series,
  top categories with comparison, coming-up list, privacy.

## Phase 5 Part B: History workbench (2026-10-19)

### Added
- **History is now a workbench**: quick ranges (this month / last month / this year /
  all time) and custom dates; search in details; filters for type, account, category,
  amount range, import, and "linked to an asset / loan"; sort by date or amount; group
  by day, month or category; live totals; filters kept in the page address. Opens on
  this month, like before.
- **Bulk changes** on ticked transactions (or "select all"): change category or account,
  link/unlink an asset or loan, convert expenses to assets, transfers or card/loan
  payments, delete (with confirmation). Register movements can't be ticked.
- **Rules** (History → Rules): "if details contain … then set category / account, link
  asset / loan". Preview of the past transactions a rule would change, one-click apply,
  pause/resume, delete. **Suggested** on the Add form with an Apply button.
- **Edit history** for every transaction (added, edited, deleted, bulk change, rule,
  import, undo, convert) with before → after details on its page; **Recently deleted**
  list in Settings.
- Demo: two example rules for Nimal.
- 13 new tests (124 total): filters, every bulk action, register movements protected,
  rules preview/apply/validation, edit history incl. after deletion, privacy.

### Changed
- Editing and deleting a transaction now also writes its edit history.
- Date filters use real month ends (30/09, 28/02); old History links still work.

## Phase 5 Part A: Excel import (2026-10-15)

### Added
- **Import from Excel** (History → Import, or Settings → Import). Reads the "Budget
  Tracking" table of "Personal Budget Tracker" (or any sheet with Date / Type /
  Category / Amount / Details columns); formula cells use their calculated values.
  The file is read in memory and not kept.
- **Three steps**: (1) Categories: tracked account, starting balance, and what each
  spreadsheet "Type / Category" becomes, with smart defaults (savings → transfers,
  big asset purchases → assets, debt → you choose; "Fun & vacation" matches "Fun &
  Vacation", etc.); new categories can be created; (2) Review: filters (needs a
  decision, assets, debt, skipped, already imported), search, per-row and bulk changes,
  asset name/class/life per row, link interest to a loan; (3) Post: spreadsheet vs
  posted totals per category, with ✓ when they match.
- **No duplicates**: re-uploading only adds new rows (identical repeated rows are
  told apart). **Undo** a whole import, including assets it bought.
- Each imported transaction keeps its **original spreadsheet row**, shown on its page.
- **Late income shift** setting (Settings), copied from your spreadsheet if you choose.
- SheetJS 0.20.3 installed from the official SheetJS site.
- 15 new tests (111 total) using a fake workbook laid out like the real one.

### Checked
- Dry run of the real spreadsheet into a throwaway database: 855 rows read, 854
  posted (1 blank amount skipped), 0 errors, every category total matches, 0
  unbalanced transactions, no account below zero with a starting balance of 0,
  undo removed everything.

## Phase 4: Credit cards & loans (2026-10-15)

### Added
- **Credit cards & loans register** (Registers → Credit cards & loans): credit cards,
  pawning, bank/personal loans, leases and other debts, with lender, rate, credit
  limit (cards), monthly instalment and end date (loans), payment due day and notes.
- Start with **nothing owed**, a **balance already owed** (via Opening Balances), or
  **borrowing now** with optional **fees deducted** (counted as an expense).
- **Credit cards in "Paid from"** on the Expense form and when buying an asset; the
  expense counts normally and what you owe goes up. Warning when over the credit left.
- **Make a payment**: split into what comes off the debt (not an expense) and
  interest (an expense). Loans suggest this month's interest from the rate; the
  monthly instalment is pre-filled. Loans are marked **Paid off** automatically.
- **Interest or fees charged**, **borrow more / cash advance**, delete a single
  movement, edit details, delete a card or loan (refused while purchases still use it).
- **Reminders**: "Due in the next 7 days" and "Payment missed" sections; warnings on
  each page and on Home.
- Each page shows what you owe, limit and credit available (cards), borrowed and
  instalment (loans), paid off so far, interest & fees paid, next payment, and every
  purchase and payment.
- Home **Debts** tile is real and **net worth subtracts what you owe**; Accounts has a
  "Money you owe" group; History shows borrowing, payments and charges and counts
  interest and fees in monthly expenses.
- Demo data: a credit card with monthly purchases and payments, a pawning loan, and a
  bank loan with monthly instalments split into principal and interest.
- 19 new tests (96 total): card spending, card payments not being an expense, owed-at-
  start balancing, charges, buying an asset on a card, fees deducted, payment split,
  pawning paid off in one go, due-soon / missed rules (incl. short months), privacy.

### Changed
- Shared "Are you sure?" button moved to `src/components/confirm-button.tsx`.

## Phase 3: Lending & investments (2026-10-15)

### Added
- **Lending & investments register** (Registers → Lending & investments): cheque
  exchanges, personal loans, fixed deposits and other investments, each with who has
  the money, rate (per month or per year), due date, status and notes.
- **Lend / invest**, with optional **interest kept up front** (hand over 96,000 on a
  100,000 loan; the 4,000 counts as interest that day; 100,000 is owed back).
- **Money received**: enter the total; it's split into loan repayment and interest
  automatically (editable). Loans are marked **Repaid** when everything is back.
- **Lend more**, **write off** (to a new "Bad debts" expense), delete a single money
  movement (e.g. undo a write-off), edit details, delete a loan.
- The normal **Income form** can link interest to a loan ("From a loan or investment?").
- Register totals: money out now, interest earned this year and all-time, overall
  return; **Overdue** (red) and **Due in the next 30 days** sections. Each loan's page
  shows lent, paid back, interest received vs expected, return % and every movement.
- Home "Lent out" tile shows the real total with an overdue warning; Accounts shows a
  "Lent out & invested" group; History shows lending, money back and write-offs and
  counts loan interest in monthly income.
- Demo data: a repaid cheque exchange with interest kept up front, an overdue cheque
  exchange, a fixed deposit with monthly interest, and a small personal loan.
- 15 new tests (77 total): every movement balances, the up-front and 104,000 cases,
  the split, partial repayments, automatic Repaid, write-off and undo, overdue /
  due-soon, and privacy.

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
