import { ThemeToggle, Brand } from 'pocket-ledger';

export const Default = () => <ThemeToggle />;

export const InTopBar = () => (
  <header className="flex w-96 items-center justify-between border-b px-4 py-2">
    <Brand />
    <ThemeToggle />
  </header>
);
