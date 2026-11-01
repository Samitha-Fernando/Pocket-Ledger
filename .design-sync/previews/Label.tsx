import { Label, Input, Switch } from 'pocket-ledger';

export const ForInput = () => (
  <div className="grid w-72 gap-1.5">
    <Label htmlFor="payee">Payee</Label>
    <Input id="payee" placeholder="Who was paid?" />
  </div>
);

export const ForSwitch = () => (
  <div className="flex items-center gap-2">
    <Switch id="recurring" />
    <Label htmlFor="recurring">Repeat every month</Label>
  </div>
);
