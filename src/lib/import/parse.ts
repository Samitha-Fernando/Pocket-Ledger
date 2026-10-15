import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseDate } from "@/lib/format";

/**
 * Reads a budget spreadsheet (like "Personal Budget Tracker") into plain rows.
 * Finds the sheet and header row by their names, so moved columns still work.
 * Formula cells give their calculated value. Nothing here touches the database.
 */

export type ParsedRow = {
  rowNumber: number; // as shown in Excel (1-based)
  date: string | null; // "YYYY-MM-DD"
  type: string;
  category: string;
  amount: number | null; // cents
  details: string | null;
  raw: Record<string, unknown>; // the original cells, for audit
};

export type ParsedWorkbook = {
  sheetName: string;
  rows: ParsedRow[];
  lateIncomeDay: number | null; // from the Settings sheet, if "Shift late Income" is Active
};

export class ImportError extends Error {}

const REQUIRED = ["date", "type", "category", "amount"] as const;

function cellText(v: unknown) {
  return v == null ? "" : String(v).trim();
}

/** Excel date serial (1900 system) → "YYYY-MM-DD". */
function serialToIso(serial: number) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
}

function toIsoDate(v: unknown): string | null {
  if (typeof v === "number") return serialToIso(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const text = cellText(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = parseDate(text); // dd/MM/yyyy
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A number from Excel (e.g. 1234.5 or 1234.5600000001) → whole cents. */
function toCents(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(cellText(v).replace(/[,\s]/g, "").replace(/^rs\.?/i, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Finds the header row (Date / Type / Category / Amount / Details) within the first 50 rows. */
function findHeader(grid: unknown[][]) {
  for (let r = 0; r < Math.min(grid.length, 50); r++) {
    const cols: Record<string, number> = {};
    grid[r]?.forEach((v, c) => {
      const t = cellText(v).toLowerCase();
      if (["date", "type", "category", "amount", "details"].includes(t) && cols[t] === undefined) cols[t] = c;
    });
    if (REQUIRED.every((k) => cols[k] !== undefined)) return { row: r, cols };
  }
  return null;
}

/** Reads "Shift late Income: Active" and "Starting on day x in month: 25" from a Settings sheet. */
function readLateIncome(book: XLSX.WorkBook): number | null {
  const sheet = book.Sheets["Settings"];
  if (!sheet) return null;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const valueRightOf = (label: RegExp) => {
    for (const row of grid) {
      const i = row.findIndex((v) => label.test(cellText(v)));
      if (i >= 0) return row.slice(i + 1).find((v) => cellText(v) !== "") ?? null;
    }
    return null;
  };
  const active = cellText(valueRightOf(/^shift late income/i)).toLowerCase() === "active";
  const day = Number(valueRightOf(/^starting on day/i));
  return active && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

export function parseWorkbook(data: Buffer | Uint8Array): ParsedWorkbook {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(data, { type: "buffer", cellDates: false, cellFormula: false });
  } catch {
    throw new ImportError("That file couldn't be read as a spreadsheet. Please upload the .xlsx file.");
  }

  const names = ["Budget Tracking", ...book.SheetNames.filter((n) => n !== "Budget Tracking")];
  for (const sheetName of names) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    // Absolute rows/columns so row numbers match what you see in Excel.
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, range: { s: { r: 0, c: 0 }, e: range.e } });
    const header = findHeader(grid);
    if (!header) continue;

    const { cols } = header;
    const rows: ParsedRow[] = [];
    for (let r = header.row + 1; r < grid.length; r++) {
      const line = grid[r] ?? [];
      const get = (k: string) => (cols[k] === undefined ? null : line[cols[k]]);
      const [date, type, category, amount, details] = ["date", "type", "category", "amount", "details"].map(get);
      if ([date, type, category, amount].every((v) => cellText(v) === "")) continue; // empty table row
      rows.push({
        rowNumber: r + 1,
        date: toIsoDate(date),
        type: cellText(type),
        category: cellText(category),
        amount: toCents(amount),
        details: cellText(details) || null,
        raw: { date, type, category, amount, details },
      });
    }
    return { sheetName, rows, lateIncomeDay: readLateIncome(book) };
  }
  throw new ImportError("Couldn't find a sheet with Date, Type, Category and Amount columns.");
}

/**
 * A row's identity across uploads: same date, type, category, amount and details.
 * `occurrence` separates genuinely repeated rows (e.g. two identical bus fares that day).
 */
export function fingerprint(row: Pick<ParsedRow, "date" | "type" | "category" | "amount" | "details">, occurrence: number) {
  const key = [row.date, row.type, row.category, row.amount, row.details ?? "", occurrence].join("|").toLowerCase();
  return createHash("sha256").update(key).digest("hex");
}

/** Fingerprints for every row, numbering identical rows 1, 2, 3… in sheet order. */
export function fingerprintAll(rows: ParsedRow[]) {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = [row.date, row.type, row.category, row.amount, row.details ?? ""].join("|").toLowerCase();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return fingerprint(row, n);
  });
}
