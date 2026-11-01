import { ThemePicker, Label } from 'pocket-ledger';

export const Default = () => (
  <div className="grid w-80 gap-2">
    <Label>Appearance</Label>
    <ThemePicker />
  </div>
);
