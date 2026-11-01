---
category: Actions
---
The standard clickable button. Built on Base UI's Button.

- `variant`: `default` (teal primary, one main action per view), `outline`, `secondary`, `ghost` (toolbar / icon actions), `destructive` (soft red tint), `link`.
- `size`: `xs`, `sm`, `default` (32px tall), `lg`, plus square icon sizes `icon-xs`, `icon-sm`, `icon`, `icon-lg`.
- Put a lucide icon before the label; it is auto-sized to 16px. Icon-only buttons need `aria-label`.

```jsx
<Button>Save entry</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost" size="icon" aria-label="Edit"><PencilIcon /></Button>
```
