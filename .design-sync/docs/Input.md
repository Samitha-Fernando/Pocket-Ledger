---
category: Forms
---
Single-line text input (Base UI Input). 32px tall, rounded, `border-input`, teal focus ring. Takes every native `<input>` prop. Set `aria-invalid` to show the red error state. Pair with `Label` via `htmlFor`/`id`. For money, use `inputMode="decimal"`.

```jsx
<div className="grid gap-1.5">
  <Label htmlFor="amount">Amount</Label>
  <Input id="amount" inputMode="decimal" placeholder="0.00" />
</div>
```
