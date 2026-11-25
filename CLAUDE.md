# Pocket Ledger: notes for Claude

Full product brief: `docs/PROJECT_BRIEF.md`. The owner is not a developer.

## Working agreement
- Build in phases (see brief §12). Before a phase: short plain-English plan, wait for OK.
  After a phase: explain what was built, how to test it, suggest a commit message,
  update `CHANGELOG.md` and `README.md`. Never commit unless asked.
- Explain trade-offs before changing the design or the tech stack.

## Conventions
- Money is integer cents (`src/lib/format.ts`); never floats. Dates shown dd/MM/yyyy.
- Feature code gets data via `getUserDb()` (`src/lib/auth/session.ts`), never the raw
  `prisma` client. New tables with `userId` must be added to `USER_OWNED_MODELS` in
  `src/lib/db/scoped.ts` (a test enforces this).
- Every protected page/action starts with `requireUser()` / `getUserDb()`; ledger pages use
  `getLedger()` (also ensures system accounts + posts due depreciation).
- Form entries go through `saveEntry` (`src/lib/ledger/engine.ts`); asset entries
  (purchase, depreciation, revaluation, sale) only through `src/lib/ledger/assets.ts`;
  loan entries (lend, money back, write-off) only through `src/lib/ledger/loans.ts`;
  debt entries (owed-at-start, borrow, payment, charge) only through `src/lib/ledger/debts.ts`
  (entries with `debtId` are blocked from saveEntry/deleteEntry). Credit cards (LIABILITY,
  subtype CARD) can pay for expenses/assets: use `canPayFrom`.
  Account subtypes FIXED / LENT are not "money" accounts (`isMoneyAccount`).
  System accounts are found by `systemKey`, never by name.
- Excel import: `src/lib/import/` (parse.ts pure; mapping.ts pure; batch.ts stage/post/undo).
  Posted entries carry `importRowId`. Never print or copy the user's real spreadsheet;
  dry-run against a throwaway DB (data/dryrun.db) and report counts only.
- Edit history: `src/lib/ledger/history.ts` (EntryChange, snapshots). saveEntry/deleteEntry record it;
  pass `opts.change` for BULK/RULE/CONVERT. Bulk ops: `bulk.ts`; rules: `rules.ts` (+ browser-safe
  `rule-match.ts`); workbench search: `search.ts`.
- Reports: `src/lib/ledger/reports.ts` (pure functions over ledger lines; late income shift via
  `effectiveDate`). Charts: `src/components/dashboard-charts.tsx` (Recharts; colours from
  --chart-income / --chart-expense / --chart-moved in globals.css).
- Budgets: `src/lib/ledger/budgets.ts` (lineKey "ACCOUNT:<id>" | "ASSETS" | "DEBTS"; actuals use
  ReportLines). Budget sheet import: `src/lib/import/budget-sheet.ts` (pure) + `budget-draft.ts`.
- Tests share `tests/helpers.ts#resetDb` — add new tables there (children first).
- Asset photos: `src/lib/uploads.ts` (./uploads, git-ignored), served only via
  `/api/assets/[id]/photo` after an ownership check.
- Local desktop use: `scripts/app.ts` (start/stop/update/shortcuts; `APP_PORT`, `APP_NO_WINDOW`
  for automated checks) + `scripts/windows/*.vbs|cmd`. Whole-app backups: `src/lib/backup/local.ts`
  (VACUUM INTO, keeps 30, optional copy folder in data/backup-settings.json; `BACKUP_DIR` override).
  Never test the launcher on port 3000 or the real DB: use APP_PORT=3100 + demo.db.
- Personal export/backup/restore: `src/lib/export/personal.ts`, served by `/api/export/[format]`.
  New user-owned tables must be added to its export/restore table list too.
- `User.disabledAt`: disabled users get no session (session.ts) and can't log in.
- UI: kinds of money have palette tokens `--tone-money|savings|owe|lent|assets|income|expense` in
  `globals.css` (light + dark; Tailwind `bg-tone-*`, `text-tone-*`); `TONES` (`src/components/stat-tile.tsx`,
  with `StatTile`) maps them to chip/bar/text/edge classes. Reuse these, never raw Tailwind hues
  (amber stays only for warnings). Pages render `<WidePage />` (`coming-soon.tsx`)
  to use the full width; the app layout keeps others at reading width. Check layouts with
  screenshots at 390 / 1024 / 1366 / 1920 in light and dark (demo DB, port 3100). Build test copies with
  `NEXT_DIST_DIR=.next-preview` (also pass it to app:start) so the owner's running app (.next) isn't disturbed.
- Register charts: `src/components/register-charts.tsx` (Donut, BarList, DueChart, UsageBar; shades of one
  tone via `shade()`), week grouping in `src/lib/ledger/due-buckets.ts` (pure, tested).
- Next.js 16: middleware is `src/proxy.ts`. Bundled docs: `node_modules/next/dist/docs`.
- Prisma 7: config in `prisma.config.ts`, client generated to `src/generated/prisma`,
  libSQL driver adapter. Run `npx prisma generate` after schema changes.
- npm 11 `allowScripts` is in package.json; approve install scripts explicitly.
- Never put real financial data in the repo; demo data lives in `scripts/seed-demo.ts`.

## Checks
`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
