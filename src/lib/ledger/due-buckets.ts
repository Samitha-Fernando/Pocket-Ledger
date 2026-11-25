/**
 * Groups amounts by when they're due: one "Overdue" bucket, then one per week starting today
 * (labelled with the week's first day, dd/MM). Pure; used by the register charts.
 */
export type DueItem = { date: string; amount: bigint };
export type DueBucket = { label: string; amount: number; overdue?: boolean };

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueBuckets(items: DueItem[], today: string, weeks = 8): DueBucket[] {
  const buckets: DueBucket[] = [{ label: "Overdue", amount: 0, overdue: true }];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(today, w * 7);
    buckets.push({ label: `${start.slice(8, 10)}/${start.slice(5, 7)}`, amount: 0 });
  }
  const end = addDays(today, weeks * 7);
  for (const { date, amount } of items) {
    if (amount <= BigInt(0) || date >= end) continue;
    if (date < today) {
      buckets[0].amount += Number(amount);
      continue;
    }
    const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    buckets[1 + Math.floor(days / 7)].amount += Number(amount);
  }
  // Drop an empty overdue bucket so the chart starts at this week.
  return buckets[0].amount > 0 ? buckets : buckets.slice(1);
}
