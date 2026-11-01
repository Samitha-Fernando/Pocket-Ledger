import { LogoMark } from 'pocket-ledger';

export const Sizes = () => (
  <div className="flex items-end gap-4">
    <LogoMark className="size-6" />
    <LogoMark />
    <LogoMark className="size-12" />
    <LogoMark className="size-16" />
  </div>
);

export const OnDark = () => (
  <div className="dark flex items-center gap-4 rounded-xl bg-background p-4">
    <LogoMark />
    <LogoMark className="size-12" />
  </div>
);
