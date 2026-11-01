# Design sync notes (Claude Design)

Pocket Ledger is a Next.js app, not a published component package, so the sync is fed by hand-made inputs:

- **Entry**: `.design-sync/entry.ts` re-exports the scoped components, `ThemeProvider` (next-themes), `toast` (sonner), `cn`, and a curated lucide icon set. Build with `--entry ./.design-sync/entry.ts --node-modules ./node_modules`. `@/` aliases resolve through `cfg.tsconfig`.
- **Component list**: there are no `.d.ts` files, so `componentSrcMap` is the full list (not sparse) and `dtsPropsFor` holds every props body by hand. When a component's props change in `src/components`, update `dtsPropsFor` too.
- **CSS**: Tailwind v4 needs compiling. Run `node .design-sync/build-css.mjs` (= `cfg.buildCmd`) BEFORE the converter. It compiles `.design-sync/styles.src.css` (imports `src/app/globals.css`, scans the whole repo + `previews/`) into `.design-sync/.cache/ds-compiled.css`, which is `cfg.cssEntry`. New preview classes only exist after re-running it.
- **Fonts**: the app loads Geist via `next/font`; the sync loads Geist + Geist Mono from Google Fonts (`@import` prepended by build-css.mjs) and sets `--font-geist-sans/mono` in styles.src.css.
- **Guidelines**: `guidelinesGlob: []` on purpose. The default glob picks up `docs/PROJECT_BRIEF.md` (private product brief) - never upload it.
- **Docs/groups**: `.design-sync/docs/<Name>.md` (frontmatter `category` = group: Actions, Forms, Layout, Feedback, Brand).
- **Provider**: `ThemeProvider` with `attribute="class"`, `defaultTheme="light"` (ThemeToggle, ThemePicker, Toaster read `useTheme`).
- Stage converter deps with `npm i esbuild ts-morph @types/react postcss playwright` in `.ds-sync/`, then `npx playwright install chromium`.
- **Browser for checks**: the bundled Chromium download was very slow on this machine; Microsoft Edge works. Prefix validate/capture/resync with `DS_CHROMIUM_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`.
- **Safelist**: `styles.src.css` has `@source inline(...)` lines so the design agent's core Tailwind vocabulary exists even where the app never used a class. `conventions.md` documents only safelisted/verified names; keep both in step.
- **Card layouts**: Alert, Brand, ThemeToggle use `cardMode: column` (wide stories); Toaster uses `cardMode: single` (fixed-position toasts).

## Known render warns
- `[RENDER_THIN]` Toaster: toasts are fixed-position, so the measured root height is 0. Screenshot shows all three toasts correctly. Benign.
- `[FONT_REMOTE]` Geist / Geist Mono load from Google Fonts at runtime. Expected.

## Re-sync risks
- `dtsPropsFor` and `.design-sync/docs/*.md` are hand-written copies of the component APIs - they go stale silently if `src/components/ui/*`, `brand.tsx`, `theme-toggle.tsx` or `confirm-button.tsx` change props or variants.
- `entry.ts` icon list is hand-curated; a new lucide icon used in the app is not available to the design agent until added there.
- The compiled CSS scans the whole repo, so any app class change shifts the stylesheet hash (forces upload of styling, not re-grading).
- Fonts depend on Google Fonts being reachable from Claude Design.
- First sync 2026-11-01: 13 components, all authored + graded good, render check clean.
