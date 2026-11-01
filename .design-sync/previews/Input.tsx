import { Input, Label } from 'pocket-ledger';

export const WithLabel = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="desc">Description</Label>
    <Input id="desc" placeholder="e.g. Weekly groceries" />
  </div>
);

export const Amount = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="amt">Amount</Label>
    <Input id="amt" inputMode="decimal" defaultValue="1,250.00" className="text-right tabular-nums" />
  </div>
);

export const Invalid = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="date">Date</Label>
    <Input id="date" aria-invalid defaultValue="31/02/2026" />
    <p className="text-sm text-destructive">Enter a real date (dd/MM/yyyy).</p>
  </div>
);

export const Disabled = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="acct">Account</Label>
    <Input id="acct" disabled defaultValue="Everyday Account" />
  </div>
);
