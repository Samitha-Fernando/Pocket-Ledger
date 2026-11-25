import { describe, expect, it } from "vitest";
import { dueBuckets } from "@/lib/ledger/due-buckets";

const c = (rupees: number) => BigInt(rupees * 100);

describe("dueBuckets", () => {
  it("puts amounts into overdue and weekly buckets", () => {
    const b = dueBuckets(
      [
        { date: "2026-11-20", amount: c(500) }, // overdue
        { date: "2026-11-25", amount: c(100) }, // today: week 1
        { date: "2026-12-01", amount: c(200) }, // day 6: week 1
        { date: "2026-12-02", amount: c(300) }, // day 7: week 2
        { date: "2027-02-01", amount: c(999) }, // beyond 8 weeks: left out
        { date: "2026-12-10", amount: c(0) }, // nothing due: left out
      ],
      "2026-11-25",
    );
    expect(b).toHaveLength(9);
    expect(b[0]).toEqual({ label: "Overdue", amount: 50000, overdue: true });
    expect(b[1]).toEqual({ label: "25/11", amount: 30000 });
    expect(b[2]).toEqual({ label: "02/12", amount: 30000 });
    expect(b.slice(3).every((x) => x.amount === 0)).toBe(true);
  });

  it("drops the overdue bucket when nothing is overdue", () => {
    const b = dueBuckets([{ date: "2026-11-30", amount: c(10) }], "2026-11-25", 4);
    expect(b.map((x) => x.label)).toEqual(["25/11", "02/12", "09/12", "16/12"]);
    expect(b[0].amount).toBe(1000);
  });
});
