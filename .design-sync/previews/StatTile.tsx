import {
  StatTile, TONES, LandmarkIcon, TrendingUpIcon, TrendingDownIcon, PiggyBankIcon,
  WalletIcon, CreditCardIcon, HandCoinsIcon, PackageIcon, ScaleIcon, cn,
} from 'pocket-ledger';

export const DashboardRow = () => (
  <div className="grid w-[46rem] grid-cols-4 gap-3">
    <StatTile label="Net worth" icon={LandmarkIcon} value="$48,210.55" sub="+$1,320.10 this month" />
    <StatTile label="Income" icon={TrendingUpIcon} tone="income" value="$6,400.00" sub="This month" />
    <StatTile label="Expenses" icon={TrendingDownIcon} tone="expense" value="$3,915.20" sub="incl. $210.00 depreciation" />
    <StatTile label="Kept (not spent)" icon={PiggyBankIcon} tone="savings" value="38.8%" sub="$2,000.00 moved to savings" />
  </div>
);

export const KindsOfMoney = () => (
  <div className="grid w-[46rem] grid-cols-3 gap-3">
    <StatTile label="Your money" icon={WalletIcon} tone="money" value="$12,480.00" sub="4 accounts" />
    <StatTile label="Lent out & invested" icon={HandCoinsIcon} tone="lent" value="$2,300.00" sub="2 open" />
    <StatTile label="Fixed assets" icon={PackageIcon} tone="assets" value="$6,027.08" sub="worth now" />
    <StatTile label="You owe" icon={CreditCardIcon} tone="owe" value="$1,353.00" sub="cards & loans" />
    <StatTile label="Net worth" icon={ScaleIcon} value="$19,454.08" sub="own − owe" />
  </div>
);

export const NegativeValue = () => (
  <div className="w-56">
    <StatTile label="Kept (not spent)" icon={PiggyBankIcon} tone="savings" value="-12.4%" valueClassName="text-destructive" sub="Spent more than came in" />
  </div>
);

export const ToneClasses = () => (
  <div className="grid w-80 gap-2.5 rounded-xl border bg-card p-4">
    {([
      ['Cash', 'money', 62],
      ['Savings', 'savings', 48],
      ['Lent out', 'lent', 20],
      ['Fixed assets', 'assets', 74],
    ] as const).map(([label, tone, pct]) => (
      <div key={label} className="grid gap-1">
        <span className="flex items-center gap-2 text-sm">
          <span className={cn('size-2 rounded-full', TONES[tone].bar)} />
          {label}
        </span>
        <span className="h-2 overflow-hidden rounded-full bg-muted">
          <span className={cn('block h-full rounded-full', TONES[tone].bar)} style={{ width: `${pct}%` }} />
        </span>
      </div>
    ))}
  </div>
);
