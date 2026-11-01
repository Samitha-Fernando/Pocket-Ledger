import { Brand } from 'pocket-ledger';

export const Default = () => <Brand />;

export const Large = () => <Brand className="text-2xl [&_svg]:size-10" />;

export const InHeader = () => (
  <header className="flex w-96 items-center justify-between border-b px-4 py-3">
    <Brand />
    <span className="text-sm text-muted-foreground">Home</span>
  </header>
);
