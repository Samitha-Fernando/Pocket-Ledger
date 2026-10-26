/**
 * Whole-app backup from the command line.
 *   npm run backup            → back up now
 *   npm run backup -- --if-due → only if the last backup is older than ~a day
 */
import "dotenv/config";

async function main() {
  const { backupIfDue, runBackup } = await import("../src/lib/backup/local");
  const { prisma } = await import("../src/lib/db/client");
  const result = process.argv.includes("--if-due") ? await backupIfDue() : await runBackup("Manual (command line)");
  if (!result) console.log("A recent backup already exists; nothing to do.");
  else {
    console.log(`Backup saved: ${result.folder}`);
    if (result.copiedTo) console.log(`Copied to: ${result.copiedTo}`);
    if (result.copyError) console.log(`Copy to second folder failed: ${result.copyError}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
