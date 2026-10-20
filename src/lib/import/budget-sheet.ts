import * as XLSX from "xlsx";
import { type AccountLite, findByName, normalise } from "./mapping";
import { ImportError } from "./parse";

/**
 * Reads the "Budget Planning" sheet: year blocks side by side (Jan … Dec, Total),
 * the year above each block, and Income / Expenses / Savings sections down the side.
 * Formula cells give their calculated value. Pure: no database.
 */

export type SheetGroup = "INCOME" | "EXPENSE" | "SAVINGS";
export type SheetBudgetLine = { group: SheetGroup; label: string; values: Record<string, number> }; // "YYYY-MM" → cents

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SECTIONS: Record<string, SheetGroup> = { income: "INCOME", expenses: "EXPENSE", expense: "EXPENSE", savings: "SAVINGS", saving: "SAVINGS" };

const text = (v: unknown) => (v == null ? "" : String(v).trim());

export function parseBudgetSheet(data: Buffer | Uint8Array): SheetBudgetLine[] {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(data, { type: "buffer" });
  } catch {
    throw new ImportError("That file couldn't be read as a spreadsheet.");
  }
  const sheet = book.Sheets["Budget Planning"];
  if (!sheet) throw new ImportError("This file has no “Budget Planning” sheet.");
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, range: { s: { r: 0, c: 0 }, e: range.e } });

  // 1. Find the header row with "Jan" … and the year blocks along it.
  let headerRow = -1;
  const blocks: { col: number; year: number }[] = [];
  for (let r = 0; r < Math.min(grid.length, 40) && headerRow < 0; r++) {
    const row = grid[r] ?? [];
    row.forEach((v, c) => {
      if (!text(v).toLowerCase().startsWith("jan")) return;
      // The 11 cells to the right must be Feb … Dec.
      const ok = MONTHS.every((m, i) => text(row[c + i]).toLowerCase().startsWith(m));
      if (!ok) return;
      // The year sits somewhere above the "Jan" cell.
      let year = NaN;
      for (let up = r - 1; up >= 0 && Number.isNaN(year); up--) {
        const n = Number(grid[up]?.[c]);
        if (Number.isInteger(n) && n >= 2000 && n <= 2100) year = n;
      }
      if (!Number.isNaN(year)) blocks.push({ col: c, year });
    });
    if (blocks.length) headerRow = r;
  }
  if (blocks.length === 0) throw new ImportError("Couldn't find the months (Jan … Dec) with a year above them.");

  // 2. Label column: the first column left of the first block that holds section names.
  const firstCol = Math.min(...blocks.map((b) => b.col));
  let labelCol = -1;
  for (let c = 0; c < firstCol && labelCol < 0; c++) {
    if (grid.some((row) => (row?.[c] ? text(row[c]).toLowerCase() in SECTIONS : false))) labelCol = c;
  }
  if (labelCol < 0) throw new ImportError("Couldn't find the Income / Expenses / Savings sections.");

  // 3. Walk down: section header → its lines → "Total".
  const out: SheetBudgetLine[] = [];
  let group: SheetGroup | null = null;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const label = text(grid[r]?.[labelCol]);
    const lower = label.toLowerCase();
    if (lower in SECTIONS) {
      group = SECTIONS[lower];
      continue;
    }
    if (!group || !label) continue;
    if (lower === "total") {
      group = null;
      continue;
    }
    if (/^enter .* category/i.test(label)) continue; // empty template rows

    const values: Record<string, number> = {};
    for (const b of blocks) {
      MONTHS.forEach((_, i) => {
        const v = grid[r]?.[b.col + i];
        if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return;
        values[`${b.year}-${String(i + 1).padStart(2, "0")}`] = Math.round(v * 100);
      });
    }
    out.push({ group, label, values });
  }
  return out;
}

/** The app budget line a sheet line matches by default (null = no match yet). */
export function defaultBudgetTarget(line: Pick<SheetBudgetLine, "group" | "label">, accounts: AccountLite[]): string | null {
  const n = normalise(line.label);
  if (line.group === "EXPENSE" && n === "debt") return "DEBTS";
  if (line.group === "EXPENSE" && (n === "asset purchases" || n === "asset purchase")) return "ASSETS";
  const match =
    line.group === "INCOME"
      ? findByName(accounts, line.label, (a) => a.type === "INCOME")
      : line.group === "EXPENSE"
        ? findByName(accounts, line.label, (a) => a.type === "EXPENSE")
        : findByName(accounts, line.label, (a) => a.type === "ASSET" && a.subtype === "SAVINGS");
  return match ? `ACCOUNT:${match.id}` : null;
}
