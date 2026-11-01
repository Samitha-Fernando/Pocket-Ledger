import { Separator } from 'pocket-ledger';

export const Horizontal = () => (
  <div className="w-72 text-sm">
    <p className="font-medium">Everyday Account</p>
    <p className="text-muted-foreground">Bank · $3,410.20</p>
    <Separator className="my-3" />
    <p className="font-medium">Credit Card</p>
    <p className="text-muted-foreground">Card · -$612.45</p>
  </div>
);

export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-sm">
    <span>Income</span>
    <Separator orientation="vertical" />
    <span>Expenses</span>
    <Separator orientation="vertical" />
    <span>Transfers</span>
  </div>
);
