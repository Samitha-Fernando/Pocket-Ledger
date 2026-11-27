# Pocket Ledger — Personal Finance & Net-Worth Tracker

## 1. What I want to build

A personal finance web app that goes beyond income/expense tracking. It must track
income, expenses, cash in hand, bank and savings balances, assets I buy, money I
lend or invest and the income it earns, and money I owe — and show my real
net worth at any point in time.

Build in small, working increments, explain what you built in plain
English after each step, and stop at the end of each phase so I can test and
commit before moving on.

## 2. Core idea: double-entry under the hood, simple forms on top

Every transaction moves value **from** one account **to** another, so balances
always reconcile. I must never have to think in debits and credits — I fill in
a simple form and the app writes both sides.

### Account types
| Type | Examples |
|---|---|
| Asset | Cash in hand, bank account(s), savings account, emergency fund, money lent out (one per borrower/cheque), investments, fixed assets (bike, phone, laptop…) |
| Liability | Credit cards, pawning loan, other loans |
| Income | Employment (Net), Bank Interest, Cheque Exchange Interest, side sales, gain on asset sale |
| Expense | Food, Utilities, Groceries, Transportation, Clothing, Medicine, Body Care, Fun & vacation, Gift, Gym, Education, Assets Repairs and maintenance, Depreciation, Interest paid, Loss on asset sale, Other |
| Equity | Opening balances |

Users can add, rename, archive (not delete if used) accounts and categories.

### Transaction forms (each auto-posts a balanced entry)
| Form | From | To |
|---|---|---|
| Income received | Income category | Cash/bank |
| Expense paid | Cash/bank/credit card | Expense category |
| Transfer (incl. "save money") | Cash/bank | Savings/other own account |
| Buy asset | Cash/bank/credit card | New fixed asset (creates asset-register entry) |
| Sell / dispose asset | Fixed asset (at book value) | Cash/bank, gain or loss auto-posted |
| Lend / invest | Cash/bank | Loan-given / investment account |
| Interest / investment income | Income category | Cash/bank (linked to the loan/investment) |
| Principal returned | Loan-given account | Cash/bank |
| Borrow / take loan | Liability | Cash/bank |
| Pay credit card / loan | Cash/bank | Liability (interest portion → expense) |

Balances are **always calculated from transactions**, never typed in.

## 3. Assets register

- **Asset vs expense is my decision per purchase**, not a fixed rule. When I record
  a purchase, show a toggle "Record as asset?". If amount ≥ **Rs 50,000** (configurable
  setting), default the toggle ON and show a hint — but I can switch it off, and I can
  switch it on for anything cheaper.
- An expense can be converted to an asset later (and vice versa) from the history screen.
- Each asset: name, asset class, purchase date, cost, funding account, useful life,
  residual value, depreciation method, status (active/sold/disposed), notes, photo (optional).
- **Depreciation**: straight-line by default, monthly. Asset classes have defaults
  (e.g. Vehicles 8 yrs, Electronics/phones 3 yrs, Computers 4 yrs, Furniture 7 yrs,
  Other 5 yrs) that I can override per asset. Depreciation posts automatically
  each month (Expense: Depreciation → reduce asset value). Allow a manual revaluation.
- Repairs & maintenance expenses can be **linked to an asset**, so I can see the
  true cost of owning it (cost + repairs − current value).

## 4. Lending & investments register

Money can be lent to people or invested (e.g. Rs 100,000 at 4%) to earn interest.
- Each loan/investment: counterparty, principal, start date, rate/expected return,
  due date, status, notes.
- Interest receipts and principal repayments link to it.
- Show: total money out with people, what's due back and when, overdue items,
  interest earned per loan and overall return.

## 5. Liabilities register

Credit cards and loans: balance owed, lender, monthly payment, interest rate,
payment history. Buying on a credit card increases the liability; paying it reduces
the liability (it is NOT an expense).

## 6. Users, login & privacy (required from Phase 0)

- **Multiple users, fully separate data.** E.g. two people on the same computer
  each have their own login and see only their own data. Every record belongs to a
  user and every query is scoped by user — enforce this server-side.
- Login with **email/username + password**. After first login on a device, allow a
  quick-unlock **4–6 digit PIN**. Auto-lock after inactivity (configurable, default
  10 min). Clear "Switch user" / "Lock" button.
- Hash passwords and PINs (argon2 or bcrypt). Rate-limit and lock out after repeated
  failed attempts. Secure, httpOnly session cookies.
- Registration is **invite-only / admin-controlled** (so when hosted, only people I
  allow can sign up).
- Each user can export their data (CSV/Excel) and create a backup.

## 7. Platform & UI

- Web app, **mobile-first responsive** design: must work great on a phone screen,
  then scale up to desktop. Large touch targets, bottom navigation on mobile,
  a fast "Add transaction" button available everywhere.
- **Installable PWA** (installs on desktop and phone like an app).
- Phase 1–7 run locally on my laptop. Architecture must allow me to later deploy
  once to a server and let friends use it from desktop or phone with their own logins.
- Currency defaults to **LKR (Rs)**, with thousands separators; per-user setting.
  Dates dd/MM/yyyy. Store money as integers (cents), never floats.
- Clean, calm design. Light and dark mode.

## 8. Suggested tech stack (explain any change before making it)

- Next.js (App Router) + TypeScript
- Tailwind CSS (+ shadcn/ui components)
- Prisma ORM with **SQLite locally**, designed so I can switch to **PostgreSQL** when hosting
- Auth: Auth.js (credentials) or a simple custom session — your recommendation, explained
- Charts: Recharts
- Excel import: SheetJS (xlsx)
- Tests for the accounting logic (every posted entry must balance)

### Git / privacy rules (important — I build in public on GitHub)
- The database file, `.env`, uploads, backups and any real Excel file must be in
  `.gitignore` and **never committed**.
- Provide a **demo seed** with realistic fake data so I can record videos without
  showing my real finances.

## 9. Import existing Excel history

Source: a budget spreadsheet laid out like this:
- Sheet **"Budget Tracking"**, Excel table `Tracking`, header row 11, columns
  C–G: `Date | Type | Category | Amount | Details` (H = running balance, I = effective
  date — both calculated, ignore on import).
- `Type` is one of `Income`, `Expenses`, `Savings`. Some `Amount` cells are formulas
  (e.g. `=12000+24000+8000+7500`) — use the computed value.
- Sheet **"Budget Planning"**: monthly budget per category (import in Phase 7).
- Optional setting: income received on/after the **25th** counts toward next
  month ("late income shift"). Keep this as a per-user setting for reports.

### Import flow
1. Upload file → rows land in a **staging area**, nothing posted yet.
2. Default mapping, editable before posting:
   - `Income/*` → Income received (into a default bank account I choose)
   - `Expenses/<category>` → Expense paid
   - `Savings/Savings Account`, `Savings/Emergency Fund` → **Transfer**
     to that savings account (not an expense)
   - `Expenses/Debt` → **Liability payment** (I'll pick which liability)
   - `Expenses/Asset Purchases` → flagged for review: asset or expense
   - `Income/Cheque Exchange Interest` → interest income, optionally linked to a loan
3. I review, fix, bulk-edit, then post. Keep the **original raw row** attached to each
   transaction for audit. Import must be idempotent (re-importing doesn't duplicate)
   and a whole import batch can be undone.

## 10. History workbench (separate screen)

A powerful screen to explore and clean up all transactions (imported and new):
- Search, filter (date range, type, account, category, amount, text in details,
  import batch), sort, group by month/category.
- Bulk edit: recategorise, change account, convert expense ↔ asset, convert expense
  → transfer or liability payment, link to an asset or loan.
- **Rules**: "if details contains 'TW' → link to asset Bike" — apply to past rows and
  suggest for future ones.
- Edit history / audit trail for every change.

## 11. Dashboard

- Net worth (assets − liabilities) now and trend by month
- Cash in hand, bank, savings, money lent out, investments, fixed assets (book value), debts
- Income vs expenses by month; real savings rate
- Top expense categories; budget vs actual (after Phase 7)
- Upcoming: loans due back, card payments due
- Period selector (month / year / custom)

## 12. Build phases — stop after each one

0. **Setup**: project scaffold, git + `.gitignore`, mobile-first app shell, PWA,
   multi-user auth (password + PIN, auto-lock, user switching), demo seed.
1. **Accounts & core transactions**: chart of accounts, income / expense / transfer
   forms, double-entry engine with balance tests, account balances screen.
2. **Assets**: buy-asset flow with the ≥ Rs 50k hint, asset register, monthly
   depreciation, sell/dispose, link repairs to assets.
3. **Lending & investments**: register, interest and principal flows, due/overdue view.
4. **Liabilities**: credit cards and loans, purchases on card, payments.
5. **Import + History workbench**: staging, mapping, review, post, undo, rules, bulk edit.
6. **Dashboard & reports**: net worth, trends, savings rate, period selector.
7. **Budget planning**: monthly budgets per category, import from my sheet, budget vs actual.
8. **Hosting readiness** (later): switch to PostgreSQL, deployment guide, backups.

## 13. How to work with me

- Before each phase: give me a short plan in plain English and wait for my OK.
- After each phase: explain what was built, how to test it, and suggest a git
  commit message. Keep a `CHANGELOG.md` and a plain-English `README.md`.
- If something in this brief is unclear or a better approach exists, ask or
  explain the trade-off — don't silently change the design.
