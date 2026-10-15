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
- Tests share `tests/helpers.ts#resetDb` — add new tables there (children first).
- Asset photos: `src/lib/uploads.ts` (./uploads, git-ignored), served only via
  `/api/assets/[id]/photo` after an ownership check.
- Next.js 16: middleware is `src/proxy.ts`. Bundled docs: `node_modules/next/dist/docs`.
- Prisma 7: config in `prisma.config.ts`, client generated to `src/generated/prisma`,
  libSQL driver adapter. Run `npx prisma generate` after schema changes.
- npm 11 `allowScripts` is in package.json; approve install scripts explicitly.
- Never put real financial data in the repo; demo data lives in `scripts/seed-demo.ts`.

## Checks
`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
