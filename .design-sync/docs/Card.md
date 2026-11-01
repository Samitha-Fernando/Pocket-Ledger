---
category: Layout
---
The main content surface: white (dark: near-black) panel, rounded-xl, hairline ring, 16px padding (`size="sm"`: 12px). Compose with the sub-parts, all exported alongside it:
`CardHeader` > `CardTitle`, `CardDescription`, optional `CardAction` (top-right button); then `CardContent`; optional `CardFooter` (muted strip with top border).

```jsx
<Card>
  <CardHeader>
    <CardTitle>Net worth</CardTitle>
    <CardDescription>All accounts, today</CardDescription>
    <CardAction><Button variant="outline" size="sm">Details</Button></CardAction>
  </CardHeader>
  <CardContent><p className="text-2xl font-semibold tabular-nums">$48,210.55</p></CardContent>
</Card>
```
