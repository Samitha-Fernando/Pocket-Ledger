/**
 * Health check: confirms every transaction in the database balances to zero
 * and prints each user's account balances.
 *
 *   npm run check:ledger                 → your real database
 *   npm run check:ledger -- demo         → the demo database
 */
import "dotenv/config";

async function main() {
  if (process.argv.includes("demo")) process.env.DATABASE_URL = "file:./data/demo.db";
  const { prisma } = await import("../src/lib/db/client");
  const { scopedDb } = await import("../src/lib/db/scoped");
  const { getAccountsWithBalances } = await import("../src/lib/ledger/accounts");
  const { formatMoney } = await import("../src/lib/format");

  let problems = 0;
  const unbalanced = await prisma.entryLine.groupBy({ by: ["entryId"], _sum: { amount: true } });
  for (const row of unbalanced) {
    if (row._sum.amount !== BigInt(0)) {
      problems++;
      console.log(`✗ Entry ${row.entryId} does not balance (off by ${row._sum.amount})`);
    }
  }

  for (const user of await prisma.user.findMany()) {
    const accounts = await getAccountsWithBalances(scopedDb(prisma, user.id));
    console.log(`\n${user.name}`);
    for (const a of accounts.filter((x) => x.type === "ASSET" && !x.archived)) {
      console.log(`  ${a.name.padEnd(24)} ${formatMoney(a.balance, user.currency).padStart(18)}`);
    }
  }

  console.log(problems === 0 ? "\n✓ All transactions balance." : `\n✗ ${problems} problem(s) found.`);
  await prisma.$disconnect();
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
