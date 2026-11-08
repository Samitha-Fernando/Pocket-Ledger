/**
 * Runs Pocket Ledger as an everyday app on this Windows computer.
 *
 *   npm run app:start      start quietly in the background (backs up once a day), open the app window
 *   npm run app:stop       stop it
 *   npm run app:update     after new features: back up, stop, install, update database, rebuild
 *   npm run app:shortcuts  put "Pocket Ledger" on the Desktop and Stop / Update / Back up in the Start menu
 *
 * The desktop icon runs scripts/windows/start.vbs, which calls "app:start" with no window.
 */
import "dotenv/config";
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.APP_PORT ?? 3000);
const URL = `http://localhost:${PORT}`;
const LOG = path.join(ROOT, "data", "app.log");

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/** A Windows message box (the launcher has no console window to print to). */
function notify(message: string) {
  const safe = message.replace(/'/g, "''");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safe}', 'Pocket Ledger') | Out-Null`]);
  } catch {
    // no desktop session (e.g. run from a terminal): the log has it
  }
}

async function isOurAppUp() {
  try {
    const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json()).app === "pocket-ledger";
  } catch {
    return false;
  }
}

/** The process id listening on our port, if any. */
function pidOnPort(): number | null {
  try {
    // A listening socket has no remote side (port 0). Neither netstat nor the State field is
    // used: on some Windows builds netstat leaves listeners out and states come back wrong.
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 -and $_.RemotePort -eq 0 } | Select-Object -First 1 -ExpandProperty OwningProcess`],
      { encoding: "utf8" },
    );
    const pid = Number(out.trim());
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Opens the app in its own window (Edge or Chrome "app mode"), or the default browser. */
function openWindow() {
  if (process.env.APP_NO_WINDOW) return; // for automated checks
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  const browser = candidates.find((p) => existsSync(p));
  if (browser) spawn(browser, [`--app=${URL}`], { detached: true, stdio: "ignore" }).unref();
  else spawn("cmd", ["/c", "start", "", URL], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** True if the running app started before the latest build (e.g. after a fix), so it's out of date. */
function runningOldBuild() {
  const pid = pidOnPort();
  const buildFile = path.join(ROOT, ".next", "BUILD_ID");
  if (!pid || !existsSync(buildFile)) return false;
  try {
    const started = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { encoding: "utf8" }).trim();
    return new Date(started).getTime() < statSync(buildFile).mtimeMs;
  } catch {
    return false;
  }
}

async function start() {
  if (await isOurAppUp()) {
    if (!runningOldBuild()) {
      log("Already running; opening the window.");
      openWindow();
      return;
    }
    log("A newer version has been built; restarting…");
    stop();
    for (let i = 0; i < 20 && (await isOurAppUp()); i++) await new Promise((r) => setTimeout(r, 500));
  }
  if (pidOnPort()) {
    notify(`Another program is using port ${PORT}, so Pocket Ledger can't start. Close it (or restart the computer) and try again.`);
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    log("No build yet: building (first start takes a minute or two)…");
    execSync("npm run build", { stdio: "inherit" });
  }

  // Daily backup before the app starts.
  try {
    const { backupIfDue } = await import("../src/lib/backup/local");
    const result = await backupIfDue();
    if (result) log(`Backup saved: ${result.folder}${result.copiedTo ? ` (copied to ${result.copiedTo})` : ""}${result.copyError ? ` (copy failed: ${result.copyError})` : ""}`);
    else log("Recent backup exists; skipping.");
  } catch (err) {
    log(`Backup failed: ${err instanceof Error ? err.message : err}`);
  }

  mkdirSync(path.dirname(LOG), { recursive: true });
  const out = openSync(LOG, "a");
  const next = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  spawn(process.execPath, [next, "start", "-p", String(PORT)], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, NODE_ENV: "production" },
  }).unref();

  for (let i = 0; i < 60; i++) {
    if (await isOurAppUp()) {
      log("Started.");
      openWindow();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  notify(`Pocket Ledger didn't start. Details are in ${LOG}`);
  process.exit(1);
}

function stop() {
  const pid = pidOnPort();
  if (!pid) {
    log("Not running.");
    return;
  }
  // Only stop it if it really is this project's Next.js server.
  const cmd = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8" });
  if (!cmd.toLowerCase().includes("next") || !cmd.toLowerCase().includes(ROOT.toLowerCase().replace(/\//g, "\\"))) {
    log(`Port ${PORT} is used by another program (pid ${pid}); not stopping it.`);
    return;
  }
  execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  log("Stopped.");
}

async function update() {
  log("Backing up first…");
  const { runBackup } = await import("../src/lib/backup/local");
  const result = await runBackup("Before update");
  log(`Backup saved: ${result.folder}`);
  stop();
  for (const [label, command] of [
    ["Installing packages", "npm install"],
    ["Updating the database", "npx prisma migrate deploy"],
    ["Preparing the database client", "npx prisma generate"],
    ["Building the app", "npm run build"],
  ]) {
    log(`${label}…`);
    execSync(command, { stdio: "inherit" });
  }
  log("Update finished. Open Pocket Ledger from the desktop icon.");
}

function shortcuts() {
  const ps = (s: string) => s.replace(/'/g, "''");
  const icon = path.join(ROOT, "public", "pocket-ledger.ico");
  const vbs = (name: string) => path.join(ROOT, "scripts", "windows", name);
  const make = [
    { folder: "[Environment]::GetFolderPath('Desktop')", name: "Pocket Ledger", target: vbs("start.vbs") },
    { folder: "$menu", name: "Pocket Ledger", target: vbs("start.vbs") },
    { folder: "$menu", name: "Stop Pocket Ledger", target: vbs("stop.vbs") },
    { folder: "$menu", name: "Update Pocket Ledger", target: path.join(ROOT, "scripts", "windows", "update.cmd") },
    { folder: "$menu", name: "Back up Pocket Ledger now", target: path.join(ROOT, "scripts", "windows", "backup.cmd") },
  ];
  const script = [
    "$sh = New-Object -ComObject WScript.Shell",
    "$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Pocket Ledger'",
    "New-Item -ItemType Directory -Force $menu | Out-Null",
    ...make.map(({ folder, name, target }) =>
      [
        `$lnk = $sh.CreateShortcut((Join-Path (${folder}) '${ps(name)}.lnk'))`,
        target.endsWith(".vbs") ? `$lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '"${ps(target)}"'` : `$lnk.TargetPath = '${ps(target)}'`,
        `$lnk.WorkingDirectory = '${ps(ROOT)}'`,
        `$lnk.IconLocation = '${ps(icon)}'`,
        `$lnk.Description = '${ps(name)}'`,
        "$lnk.Save()",
      ].join("; "),
    ),
  ].join("\n");
  execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
  log("Shortcuts created: “Pocket Ledger” on the Desktop; Stop / Update / Back up in Start menu → Pocket Ledger.");
}

const command = process.argv[2];
const run = { start, stop: async () => stop(), update, shortcuts: async () => shortcuts() }[command ?? ""];
if (!run) {
  console.log("Usage: tsx scripts/app.ts start|stop|update|shortcuts");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((err) => {
    log(String(err instanceof Error ? err.stack : err));
    notify(`Something went wrong: ${err instanceof Error ? err.message : err}. Details are in ${LOG}`);
    process.exit(1);
  });
