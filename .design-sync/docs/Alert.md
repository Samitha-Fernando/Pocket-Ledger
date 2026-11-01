---
category: Feedback
---
Inline message box. `variant`: `default` or `destructive` (red text). Compose with `AlertTitle`, `AlertDescription` and optional `AlertAction` (top-right button). A lucide icon as the first child sits in its own column.

```jsx
<Alert>
  <InfoIcon />
  <AlertTitle>Import finished</AlertTitle>
  <AlertDescription>142 rows posted, 3 skipped as duplicates.</AlertDescription>
</Alert>
```
