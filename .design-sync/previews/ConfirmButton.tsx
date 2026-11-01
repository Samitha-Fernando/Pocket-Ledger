import { ConfirmButton, Trash2Icon } from 'pocket-ledger';

export const TextButton = () => (
  <form onSubmit={(e) => e.preventDefault()}>
    <ConfirmButton message="Delete this entry? This cannot be undone.">
      <Trash2Icon /> Delete entry
    </ConfirmButton>
  </form>
);

export const IconInRow = () => (
  <form onSubmit={(e) => e.preventDefault()} className="flex w-72 items-center justify-between rounded-lg border px-3 py-2 text-sm">
    <span>Groceries · 14/10/2026</span>
    <ConfirmButton size="icon" ariaLabel="Delete entry" message="Delete this entry?">
      <Trash2Icon />
    </ConfirmButton>
  </form>
);
