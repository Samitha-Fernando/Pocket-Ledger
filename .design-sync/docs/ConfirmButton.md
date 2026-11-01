---
category: Actions
---
A ghost-style submit button for deletes. Shows the browser's "are you sure?" dialog with `message` and cancels the submit if the user says no. Use inside a `<form>`.

- Without `size`: red text button, 40px tall (e.g. "Delete entry").
- `size="icon"`: muted icon button that turns red on hover (e.g. a trash icon in a list row); pass `ariaLabel`.

```jsx
<ConfirmButton message="Delete this entry?"><Trash2Icon /> Delete</ConfirmButton>
<ConfirmButton size="icon" ariaLabel="Delete" message="Delete this entry?"><Trash2Icon /></ConfirmButton>
```
