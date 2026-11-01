---
category: Forms
---
On/off toggle (Base UI Switch). Teal when on. `size` is `default` or `sm`. Use `checked` + `onCheckedChange(checked)` (controlled) or `defaultChecked` (uncontrolled). Put it next to a `Label`.

```jsx
<div className="flex items-center gap-2">
  <Switch id="hide-zero" defaultChecked />
  <Label htmlFor="hide-zero">Hide zero balances</Label>
</div>
```
