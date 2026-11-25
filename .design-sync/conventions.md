# Pocket Ledger design conventions

Pocket Ledger is a calm personal-finance app (shadcn-style on Base UI, Tailwind v4 utilities, Geist font, teal primary). Build screens from the library components and lay them out with the Tailwind classes below.

## Setup
Wrap the whole tree in `ThemeProvider` (from next-themes, exported by the bundle). `ThemeToggle`, `ThemePicker` and `Toaster` throw or misbehave without it. Mount `<Toaster />` once and call `toast(...)`.

```jsx
const { ThemeProvider, Toaster } = window.PocketLedger;
<ThemeProvider attribute="class" defaultTheme="light">
  <main className="min-h-screen bg-background text-foreground font-sans">...</main>
  <Toaster />
</ThemeProvider>
```
Dark mode = a `dark` class on an ancestor (the provider sets it on `<html>`); every token flips automatically. Never hard-code colours.

## Styling: Tailwind utilities on semantic tokens
Only classes present in `styles.css` work (it is precompiled, not a live Tailwind). Reliable families:

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-muted`, `bg-secondary`, `bg-popover`, `bg-primary/10` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-card-foreground` |
| Lines | `border`, `border-b`, `border-t`, `border-border`, `border-input`, `divide-y`, `ring-1` |
| Spacing | `p-*`, `px-*`, `py-*`, `m*-*`, `gap-*`, `space-y-*` on steps 0.5–16 (e.g. `gap-2`, `p-4`, `space-y-6`) |
| Layout | `flex`, `grid`, `grid-cols-1..12`, `sm:`/`md:`/`lg:grid-cols-*`, `items-center`, `justify-between`, `flex-1`, `max-w-md..6xl`, `mx-auto`, `w-full` |
| Type | `text-xs..4xl`, `font-medium`, `font-semibold`, `tracking-tight`, `tabular-nums` (always for money) |
| Shape | `rounded-lg` (controls), `rounded-xl` (cards), `rounded-full` |

Tokens as CSS variables, for inline styles or charts: `var(--primary)`, `var(--muted-foreground)`, `var(--border)`, `var(--radius)`, and chart colours `var(--chart-income)` (green), `var(--chart-expense)` (red), `var(--chart-moved)` (blue).

## Kinds of money: one colour each
Every kind of money has a fixed colour family, used for icons, bars, dots and left borders (never for body text or surfaces): `money` teal (cash, bank), `savings` blue, `owe` red (cards, loans), `lent` purple, `assets` amber, `income` green, `expense` pink, `neutral` primary (net worth, totals). Don't invent other colours for them; take the classes from the bundle's `TONES` export: `TONES.<tone>.chip` (icon tile bg + text), `.bar` (solid fill for bars/dots), `.text` (coloured figure), `.edge` (with `border-l-4`), `.soft` (faint tint).

Headline numbers go in `StatTile` (`label`, `value` pre-formatted, `icon`, `tone`, optional `sub`, `href`), in a row like `grid grid-cols-2 gap-3 lg:grid-cols-4`:
```jsx
const { StatTile, TONES, TrendingUpIcon, cn } = window.PocketLedger;
<StatTile label="Income" icon={TrendingUpIcon} tone="income" value="$6,400.00" sub="This month" />
<span className={cn("block h-2 rounded-full", TONES.income.bar)} style={{ width: "62%" }} />
```

## House rules
- Money: right-aligned, `tabular-nums`, 2 decimals, e.g. `$1,250.00`; negatives with a minus sign. Dates show as dd/MM/yyyy.
- One `Button` (default variant) per view for the main action; others `outline` or `ghost`. Deletes use `ConfirmButton`.
- Group content in `Card` (sub-parts `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`). Alerts use `AlertTitle`, `AlertDescription`, `AlertAction`.
- Icons: lucide icons are on the bundle (`PlusIcon`, `Trash2Icon`, `PencilIcon`, `WalletIcon`, `PiggyBankIcon`, `LandmarkIcon`, `CreditCardIcon`, `SearchIcon`, `SettingsIcon`...). Only names exported by the bundle exist.
- Header: `Brand` on the left, `ThemeToggle` on the right.

## Where the truth lives
`styles.css` (and the `_ds_bundle.css` it imports) holds every token and class; each `components/<group>/<Name>/<Name>.prompt.md` has usage and props.

## Example
```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, Button, PlusIcon } = window.PocketLedger;
<div className="mx-auto grid max-w-4xl gap-4 p-6 md:grid-cols-2">
  <Card>
    <CardHeader>
      <CardTitle>Net worth</CardTitle>
      <CardDescription>All accounts as of 01/11/2026</CardDescription>
      <CardAction><Button size="sm"><PlusIcon /> Add entry</Button></CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-2xl font-semibold tabular-nums">$48,210.55</p>
      <p className="text-sm text-muted-foreground">+$1,320.10 this month</p>
    </CardContent>
  </Card>
</div>
```
