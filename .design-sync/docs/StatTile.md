---
category: Layout
---
A headline number in a small card: a coloured icon chip and caption on top, the value large below, and an optional muted line underneath. Use a row of them at the top of a dashboard or summary page (`grid grid-cols-2 gap-3 lg:grid-cols-4`).

`tone` picks the colour family for the kind of money, the same everywhere in Pocket Ledger: `money` teal (cash, bank), `savings` blue, `owe` red (cards, loans), `lent` purple, `assets` amber, `income` green, `expense` pink, `neutral` primary (net worth, totals). `icon` takes a lucide icon from the bundle. With `href` the whole tile becomes a link.

```jsx
<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <StatTile label="Net worth" icon={LandmarkIcon} value="$48,210.55" sub="+$1,320.10 this month" />
  <StatTile label="Income" icon={TrendingUpIcon} tone="income" value="$6,400.00" sub="This month" />
  <StatTile label="Expenses" icon={TrendingDownIcon} tone="expense" value="$3,915.20" sub="This month" />
  <StatTile label="Kept (not spent)" icon={PiggyBankIcon} tone="savings" value="38.8%" sub="$2,000.00 moved to savings" />
</div>
```

The same colour classes are exported as `TONES` (`TONES.income.text`, `.chip`, `.bar`, `.edge`, `.soft`) for your own bars, dots and borders, so custom parts match the tiles.
