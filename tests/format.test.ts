import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, parseDate, parseMoneyToCents } from "@/lib/format";

describe("formatMoney", () => {
  it("formats cents as rupees with thousands separators", () => {
    expect(formatMoney(125_000_050)).toBe("Rs 1,250,000.50");
    expect(formatMoney(0)).toBe("Rs 0.00");
    expect(formatMoney(5)).toBe("Rs 0.05");
    expect(formatMoney(-5000)).toBe("-Rs 50.00");
  });

  it("handles very large values exactly", () => {
    expect(formatMoney(BigInt("900000000000000001"))).toBe("Rs 9,000,000,000,000,000.01");
  });
});

describe("parseMoneyToCents", () => {
  it("parses typed amounts without floating-point errors", () => {
    expect(parseMoneyToCents("1250")).toBe(125000);
    expect(parseMoneyToCents("1,250.5")).toBe(125050);
    expect(parseMoneyToCents("Rs 1,250.50")).toBe(125050);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("0.29")).toBe(29); // 0.29 * 100 = 28.999… with floats
    expect(parseMoneyToCents("-75.25")).toBe(-7525);
  });

  it("rejects invalid input", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
    expect(parseMoneyToCents("1.2.3")).toBeNull();
  });
});

describe("dates", () => {
  it("formats as dd/MM/yyyy", () => {
    expect(formatDate(new Date(2025, 0, 5))).toBe("05/01/2025");
  });

  it("parses dd/MM/yyyy and rejects impossible dates", () => {
    expect(parseDate("25/12/2024")?.getTime()).toBe(new Date(2024, 11, 25).getTime());
    expect(parseDate("31/02/2025")).toBeNull();
    expect(parseDate("2025-01-05")).toBeNull();
  });
});
