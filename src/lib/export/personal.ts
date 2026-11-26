import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { UserDb } from "@/lib/db/scoped";
import { formatIsoDate } from "@/lib/format";
import { getAccountsWithBalances } from "@/lib/ledger/accounts";
import { KIND_LABELS, describeEntry } from "@/lib/ledger/describe";
import { LedgerError } from "@/lib/ledger/engine";
import { getDebts } from "@/lib/ledger/debts";
import { getLoans } from "@/lib/ledger/loans";
import { deletePhoto, readPhoto, savePhotoBytes } from "@/lib/uploads";

/** A fresh id in the same style as the database's own (c + 24 letters/digits). */
const createId = () => `c${randomBytes(12).toString("hex")}`;

/**
 * One person's data: export to Excel / CSV, a full personal backup file, and
 * restoring that backup into an empty account (e.g. when moving to a server).
 * Everything goes through the user-scoped db, so only your own data is included.
 */

const rupees = (cents: bigint | number) => Number(cents) / 100;

async function transactions(db: UserDb) {
  const entries = await db.entry.findMany({
    include: { lines: { include: { account: true } }, asset: { select: { name: true } }, loan: { select: { counterparty: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return entries.map((e) => {
    const v = describeEntry(e);
    return {
      Date: formatIsoDate(v.date),
      Type: KIND_LABELS[v.kind],
      Category: v.categoryName ?? "",
      From: v.kind === "TRANSFER" ? (v.fromName ?? "") : v.kind === "INCOME" ? (v.categoryName ?? "") : (v.accountName ?? ""),
      To: v.kind === "TRANSFER" ? (v.toName ?? "") : v.kind === "INCOME" ? (v.accountName ?? "") : (v.categoryName ?? v.assetName ?? v.loanName ?? v.debtName ?? ""),
      Amount: rupees(v.amount),
      Details: v.details ?? "",
      "Linked to": v.assetName ?? v.loanName ?? v.debtName ?? "",
      // The foreign-currency side, e.g. "USD 2000.00 @ 300".
      "Other currency": v.currency ? `${v.currency} ${(v.foreignAmount! / 100).toFixed(2)}${v.rate ? ` @ ${v.rate}` : ""}` : v.toCurrency ? `${v.toCurrency} ${(v.toForeignAmount! / 100).toFixed(2)}${v.rate ? ` @ ${v.rate}` : ""}` : "",
    };
  });
}

/** Excel workbook with a sheet per area. */
export async function exportWorkbook(db: UserDb, user: Pick<User, "name">, today: string) {
  const [txns, accounts, assets, loans, debts, budgets] = await Promise.all([
    transactions(db),
    getAccountsWithBalances(db),
    db.fixedAsset.findMany({ orderBy: { purchaseDate: "asc" } }),
    getLoans(db, today),
    getDebts(db, today),
    db.budget.findMany({ orderBy: [{ month: "asc" }] }),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const value = new Map(accounts.map((a) => [a.id, a.balance]));

  const book = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) =>
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ "": "Nothing here yet" }]), name);

  add("Transactions", txns);
  add(
    "Accounts",
    accounts
      .filter((a) => !a.isSystem || a.balance !== BigInt(0))
      .map((a) => ({
        Name: a.name,
        Type: a.type,
        Kind: a.subtype ?? "",
        Currency: a.currency ?? "",
        "Balance in its currency": a.foreignBalance !== null ? rupees(a.foreignBalance) : "",
        Archived: a.archived ? "yes" : "",
        Balance: rupees(a.valueNow),
      })),
  );
  add(
    "Assets",
    assets.map((a) => ({
      Name: a.name,
      Class: a.assetClass,
      Bought: formatIsoDate(a.purchaseDate),
      Cost: rupees(a.cost),
      "Worth now": a.status === "ACTIVE" ? rupees(value.get(a.accountId) ?? BigInt(0)) : 0,
      "Life (years)": a.usefulLifeMonths / 12,
      Status: a.status,
      Notes: a.notes ?? "",
    })),
  );
  add(
    "Lending",
    loans.map((l) => ({
      Who: l.loan.counterparty,
      Kind: l.loan.kind,
      Started: formatIsoDate(l.loan.startDate),
      Due: l.loan.dueDate ? formatIsoDate(l.loan.dueDate) : "",
      Lent: rupees(l.lent),
      "Paid back": rupees(l.returned),
      "Still out": rupees(l.out),
      Interest: rupees(l.interest),
      Status: l.loan.status,
    })),
  );
  add(
    "Cards & loans",
    debts.map((d) => ({
      Name: d.debt.name,
      Lender: d.debt.lender ?? "",
      Kind: d.debt.kind,
      Owed: rupees(d.owed),
      "Paid off": rupees(d.paid),
      "Interest & fees": rupees(d.interestAndFees),
      Status: d.debt.status,
    })),
  );
  add(
    "Budgets",
    budgets.map((b) => ({
      Month: b.month,
      Line: b.lineKey === "ASSETS" ? "Asset purchases" : b.lineKey === "DEBTS" ? "Debt payments" : (names.get(b.lineKey.slice(8)) ?? b.lineKey),
      Budget: rupees(b.amount),
    })),
  );
  book.Props = { Title: `Pocket Ledger export for ${user.name}`, CreatedDate: new Date() };
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Transactions as CSV (opens in Excel / Google Sheets). */
export async function exportCsv(db: UserDb) {
  const sheet = XLSX.utils.json_to_sheet(await transactions(db));
  return "﻿" + XLSX.utils.sheet_to_csv(sheet); // BOM so Excel reads "Rs" etc. correctly
}

// ---- Personal backup & restore -------------------------------------------------

const TABLES = ["account", "fixedAsset", "loan", "debt", "importBatch", "importRow", "entry", "entryLine", "rule", "budget", "entryChange", "exchangeRate"] as const;
type Table = (typeof TABLES)[number];
const BACKUP_VERSION = 1;

/** JSON can't hold BigInt; mark them so they come back exactly. */
const toJson = (_k: string, v: unknown) => (typeof v === "bigint" ? { $bigint: v.toString() } : v);
const fromJson = (_k: string, v: unknown) =>
  v && typeof v === "object" && "$bigint" in (v as Record<string, unknown>) ? BigInt((v as { $bigint: string }).$bigint) : v;

/** Everything of yours (and your asset photos) in one file. */
export async function exportBackup(db: UserDb, user: User) {
  const delegate = (t: Table) => (db as unknown as Record<Table, { findMany: (a?: object) => Promise<Record<string, unknown>[]> }>)[t];
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    // Drop the owner: a restore gives every record to the person restoring it.
    tables[t] = (await delegate(t).findMany()).map((row) => {
      const copy = { ...row };
      delete copy.userId;
      return copy;
    });
  }
  const photos: Record<string, string> = {};
  for (const a of tables.fixedAsset as { photoPath?: string | null }[]) {
    if (!a.photoPath) continue;
    const p = await readPhoto(a.photoPath);
    if (p) photos[a.photoPath] = Buffer.from(p.data).toString("base64");
  }
  return JSON.stringify(
    {
      app: "pocket-ledger",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: {
        name: user.name,
        currency: user.currency,
        timezone: user.timezone,
        assetThresholdCents: user.assetThresholdCents,
        lateIncomeDay: user.lateIncomeDay,
        autoLockMinutes: user.autoLockMinutes,
      },
      tables,
      photos,
    },
    toJson,
  );
}

/** True when the account has no data of its own yet (only the starting categories). */
export async function isEmptyAccount(db: UserDb) {
  const counts = await Promise.all([db.entry.count(), db.fixedAsset.count(), db.loan.count(), db.debt.count(), db.budget.count(), db.rule.count(), db.importBatch.count()]);
  return counts.every((n) => n === 0);
}

const ID_PATTERN = /\bc[a-z0-9]{20,32}\b/g;

/**
 * Restores a personal backup into an EMPTY account. Every record gets a new id
 * (so the same backup can be restored on the same server without clashes), and
 * all links between records are carried over.
 */
export async function restoreBackup(db: UserDb, userId: string, json: string) {
  let data: { app?: string; version?: number; settings?: Record<string, unknown>; tables?: Record<string, Record<string, unknown>[]>; photos?: Record<string, string> };
  try {
    data = JSON.parse(json, fromJson);
  } catch {
    throw new LedgerError("That file isn't a Pocket Ledger backup.");
  }
  if (data.app !== "pocket-ledger" || !data.tables) throw new LedgerError("That file isn't a Pocket Ledger backup.");
  if ((data.version ?? 0) > BACKUP_VERSION) throw new LedgerError("This backup was made by a newer version of Pocket Ledger. Update the app first.");
  if (!(await isEmptyAccount(db))) throw new LedgerError("Restore only works into an empty account (no transactions, assets, loans, budgets…).");

  // New id for every record; text that mentions an old id is updated too.
  const ids = new Map<string, string>();
  for (const t of TABLES) for (const row of data.tables[t] ?? []) if (typeof row.id === "string") ids.set(row.id, createId());
  const remap = (v: unknown): unknown => (typeof v === "string" ? v.replace(ID_PATTERN, (m) => ids.get(m) ?? m) : v);

  // Photos get new file names under this user.
  const photoNames = new Map<string, string>();
  for (const [oldName, b64] of Object.entries(data.photos ?? {})) {
    const saved = await savePhotoBytes(userId, new Uint8Array(Buffer.from(b64, "base64")));
    if ("name" in saved) photoNames.set(oldName, saved.name);
  }

  const counts: Record<string, number> = {};
  try {
    await db.$transaction(
      async (tx) => {
        await tx.account.deleteMany({}); // the empty account's starting categories are replaced by the backup's
        for (const t of TABLES) {
          const rows = (data.tables![t] ?? []).map((row) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) out[k] = k === "photoPath" && typeof v === "string" ? (photoNames.get(v) ?? null) : remap(v);
            return out;
          });
          if (rows.length) await (tx as unknown as Record<Table, { createMany: (a: object) => Promise<unknown> }>)[t].createMany({ data: rows });
          counts[t] = rows.length;
        }
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    for (const name of photoNames.values()) await deletePhoto(name);
    throw err;
  }

  const s = data.settings ?? {};
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(typeof s.currency === "string" && { currency: s.currency }),
      ...(typeof s.timezone === "string" && { timezone: s.timezone }),
      ...(typeof s.assetThresholdCents === "number" && { assetThresholdCents: s.assetThresholdCents }),
      ...((typeof s.lateIncomeDay === "number" || s.lateIncomeDay === null) && { lateIncomeDay: s.lateIncomeDay as number | null }),
    },
  });
  return counts;
}
