import { Switch, Label } from 'pocket-ledger';

export const States = () => (
  <div className="grid gap-3">
    <div className="flex items-center gap-2">
      <Switch id="s-on" defaultChecked />
      <Label htmlFor="s-on">Hide zero balances</Label>
    </div>
    <div className="flex items-center gap-2">
      <Switch id="s-off" />
      <Label htmlFor="s-off">Show archived accounts</Label>
    </div>
  </div>
);

export const Small = () => (
  <div className="flex items-center gap-2">
    <Switch id="s-sm" size="sm" defaultChecked />
    <Label htmlFor="s-sm">Daily backups</Label>
  </div>
);

export const Disabled = () => (
  <div className="flex items-center gap-2">
    <Switch id="s-dis" disabled defaultChecked />
    <Label htmlFor="s-dis">Google Drive copy (set up first)</Label>
  </div>
);
