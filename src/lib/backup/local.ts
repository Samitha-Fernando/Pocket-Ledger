import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/client";

/**
 * Whole-app backups on this computer: a consistent copy of the database (taken
 * with SQLite's VACUUM INTO, safe while the app is running) plus asset photos,
 * in a dated folder. The last 30 are kept, here and in an optional second folder
 * (e.g. Google Drive's "My Drive"), so a copy also lives off the laptop.
 */

const KEEP = 30;
const DUE_AFTER_HOURS = 20;
const PREFIX = "pocket-ledger-";
const COPY_SUBFOLDER = "Pocket Ledger backups";

// The "turbopackIgnore" hints stop the build bundling the whole project for run-time paths.
const fromRoot = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ process.cwd(), ...parts);
export const backupDir = () => process.env.BACKUP_DIR ?? fromRoot("backups");
const settingsFile = () => fromRoot("data", "backup-settings.json");
const uploadsDir = () => process.env.UPLOADS_DIR ?? fromRoot("uploads");

export type BackupSettings = { copyDir: string | null };

export async function readBackupSettings(): Promise<BackupSettings> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ settingsFile(), "utf8"));
    return { copyDir: typeof raw.copyDir === "string" && raw.copyDir ? raw.copyDir : null };
  } catch {
    return { copyDir: null };
  }
}

/** Saves the second backup folder (null to turn it off). Returns an error message or null. */
export async function writeBackupSettings(copyDir: string | null): Promise<string | null> {
  const dir = copyDir?.trim() || null;
  if (dir) {
    if (!path.isAbsolute(dir)) return "Enter the full folder path, e.g. G:\\My Drive";
    try {
      if (!(await stat(/*turbopackIgnore: true*/ dir)).isDirectory()) return "That isn't a folder.";
    } catch {
      return "That folder doesn't exist on this computer. Is Google Drive for desktop running?";
    }
  }
  await mkdir(/*turbopackIgnore: true*/ fromRoot("data"), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ settingsFile(), JSON.stringify({ copyDir: dir }, null, 2));
  return null;
}

/** The SQLite file the app uses (only file databases can be backed up this way). */
function databaseFile() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) throw new Error("Automatic backups need a local SQLite database (file:…).");
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.slice(5));
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type BackupInfo = { name: string; createdAt: Date; sizeBytes: number; reason: string };

/** Backups in a folder, newest first. */
export async function listBackups(dir = backupDir()): Promise<BackupInfo[]> {
  let names: string[] = [];
  try {
    names = (await readdir(/*turbopackIgnore: true*/ dir)).filter((n) => n.startsWith(PREFIX));
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    try {
      const info = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(dir, name, "info.json"), "utf8"));
      const db = await stat(/*turbopackIgnore: true*/ path.join(dir, name, "pocket-ledger.db"));
      out.push({ name, createdAt: new Date(info.createdAt), sizeBytes: db.size, reason: info.reason ?? "" });
    } catch {
      // not a complete backup folder; ignore it
    }
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function prune(dir: string) {
  const all = await listBackups(dir);
  for (const old of all.slice(KEEP)) await rm(/*turbopackIgnore: true*/ path.join(dir, old.name), { recursive: true, force: true });
}

export type BackupResult = { name: string; folder: string; copiedTo: string | null; copyError: string | null };

/** Makes a backup now. */
export async function runBackup(reason: string): Promise<BackupResult> {
  const name = `${PREFIX}${stamp()}`;
  const folder = path.join(backupDir(), name);
  await mkdir(/*turbopackIgnore: true*/ folder, { recursive: true });

  // A consistent snapshot of the database, even while the app is in use.
  const target = path.join(folder, "pocket-ledger.db").replace(/'/g, "''");
  databaseFile(); // checks it's a local SQLite database
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
  await cp(/*turbopackIgnore: true*/ uploadsDir(), path.join(folder, "uploads"), { recursive: true, force: true }).catch(() => {});
  await writeFile(/*turbopackIgnore: true*/ path.join(folder, "info.json"), JSON.stringify({ createdAt: new Date().toISOString(), reason }, null, 2));
  await prune(backupDir());

  // Second copy, e.g. in Google Drive.
  const { copyDir } = await readBackupSettings();
  let copiedTo: string | null = null;
  let copyError: string | null = null;
  if (copyDir) {
    try {
      const dest = path.join(copyDir, COPY_SUBFOLDER);
      await mkdir(dest, { recursive: true });
      await cp(/*turbopackIgnore: true*/ folder, path.join(dest, name), { recursive: true, force: true });
      await prune(dest);
      copiedTo = dest;
    } catch (err) {
      copyError = err instanceof Error ? err.message : "Couldn't copy to the second folder.";
    }
  }
  return { name, folder, copiedTo, copyError };
}

/** Backs up if the newest backup is older than ~a day (used when the app starts). */
export async function backupIfDue() {
  const [latest] = await listBackups();
  if (latest && Date.now() - latest.createdAt.getTime() < DUE_AFTER_HOURS * 3_600_000) return null;
  return runBackup("Daily (app start)");
}

export const copySubfolder = COPY_SUBFOLDER;
