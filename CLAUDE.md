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
- Every protected page/action starts with `requireUser()` / `getUserDb()`.
- Next.js 16: middleware is `src/proxy.ts`. Bundled docs: `node_modules/next/dist/docs`.
- Prisma 7: config in `prisma.config.ts`, client generated to `src/generated/prisma`,
  libSQL driver adapter. Run `npx prisma generate` after schema changes.
- npm 11 `allowScripts` is in package.json; approve install scripts explicitly.
- Never put real financial data in the repo; demo data lives in `scripts/seed-demo.ts`.

## Checks
`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
