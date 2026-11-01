import { Button, PlusIcon, PencilIcon, Trash2Icon, DownloadIcon } from 'pocket-ledger';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Save entry</Button>
    <Button variant="outline">Cancel</Button>
    <Button variant="secondary">Export</Button>
    <Button variant="ghost">Skip</Button>
    <Button variant="destructive">Delete</Button>
    <Button variant="link">View history</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="xs">Extra small</Button>
    <Button size="sm">Small</Button>
    <Button>Default</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button><PlusIcon /> New entry</Button>
    <Button variant="outline"><DownloadIcon /> Download backup</Button>
    <Button variant="ghost" size="icon" aria-label="Edit"><PencilIcon /></Button>
    <Button variant="outline" size="icon" aria-label="Delete"><Trash2Icon /></Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>Save entry</Button>
    <Button variant="outline" disabled>Cancel</Button>
  </div>
);
