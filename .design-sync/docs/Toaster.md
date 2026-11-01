---
category: Feedback
---
Mount `<Toaster />` once near the app root (inside `ThemeProvider`). Then call `toast("Saved")`, `toast.success(...)`, `toast.error(...)` (the `toast` function is exported from the bundle too). Toasts appear bottom-right in the popover colours. Accepts sonner `ToasterProps` (`position`, `richColors`, `expand`, `duration`...).
