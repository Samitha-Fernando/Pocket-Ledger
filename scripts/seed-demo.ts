/**
 * Creates a SEPARATE demo database (data/demo.db) filled with fake people,
 * so you can record videos without showing your real finances.
 *
 *   npm run seed:demo   → (re)builds data/demo.db
 *   npm run dev:demo    → runs the app against the demo database
 *
 * Your real database (data/pocket-ledger.db) is never touched.
 * Later phases add fake accounts and transactions here.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const DEMO_URL = "file:./data/demo.db";

// Fake demo logins (documented in README).
export const DEMO_USERS = [
  { name: "Nimal Perera", email: "nimal@demo.test", username: "nimal", password: "demo-pass-1", pin: "2580", role: "ADMIN" as const },
  { name: "Kumari Perera", email: "kumari@demo.test", username: "kumari", password: "demo-pass-2", pin: "1470", role: "USER" as const },
];

async function main() {
  process.env.DATABASE_URL = DEMO_URL;

  mkdirSync("data", { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`data/demo.db${suffix}`, { force: true });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: DEMO_URL }, stdio: "inherit" });

  // Import after DATABASE_URL is set so the client connects to the demo file.
  const { prisma } = await import("../src/lib/db/client");
  const { hashSecret } = await import("../src/lib/auth/crypto");
  const { scopedDb } = await import("../src/lib/db/scoped");
  const { ensureDefaultAccounts } = await import("../src/lib/ledger/accounts");
  const { saveEntry } = await import("../src/lib/ledger/engine");
  const { shiftMonth, todayIso } = await import("../src/lib/format");

  for (const [index, u] of DEMO_USERS.entries()) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        passwordHash: await hashSecret(u.password),
        pinHash: await hashSecret(u.pin),
      },
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: "account_created", details: "Demo seed" } });

    // ---- Fake money: opening balances + ~3 months of everyday transactions ----
    const db = scopedDb(prisma, user.id);
    await ensureDefaultAccounts(db);
    const acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
    const rand = seededRandom(index + 1);
    const rs = (rupees: number) => Math.round(rupees) * 100; // to cents
    const vary = (rupees: number, spread = 0.3) => rs(rupees * (1 - spread / 2 + rand() * spread));

    const today = todayIso();
    const start = shiftMonth(today.slice(0, 7), -3);
    const scale = index === 0 ? 1 : 0.7;

    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(15_000 * scale), accountId: acc["Cash in hand"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(240_000 * scale), accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(650_000 * scale), accountId: acc["Savings account"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(180_000 * scale), accountId: acc["AIA Emergency Fund"] });

    let count = 4;
    for (let m = 0; m <= 3; m++) {
      const month = shiftMonth(start, m);
      const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
      const add = async (input: Parameters<typeof saveEntry>[1]) => {
        if (input.date > today) return; // nothing in the future
        await saveEntry(db, input);
        count++;
      };
      const expense = (d: number, cat: string, amount: number, details: string, from = "Cash in hand") =>
        add({ kind: "EXPENSE", date: day(d), amount, categoryId: acc[cat], accountId: acc[from], details });

      await add({ kind: "INCOME", date: day(25), amount: rs(185_000 * scale), categoryId: acc["Employment (Net)"], accountId: acc["Bank account"], details: "Salary" });
      await add({ kind: "INCOME", date: day(28), amount: vary(2_400 * scale), categoryId: acc["Bank Interest"], accountId: acc["Savings account"], details: "Monthly interest" });
      await add({ kind: "TRANSFER", date: day(26), amount: rs(25_000 * scale), fromId: acc["Bank account"], toId: acc["Savings account"], details: "Monthly saving" });
      await add({ kind: "TRANSFER", date: day(27), amount: rs(5_000), fromId: acc["Bank account"], toId: acc["AIA Emergency Fund"], details: "AIA premium" });
      await add({ kind: "TRANSFER", date: day(3), amount: rs(40_000 * scale), fromId: acc["Bank account"], toId: acc["Cash in hand"], details: "ATM withdrawal" });
      await add({ kind: "TRANSFER", date: day(17), amount: rs(35_000 * scale), fromId: acc["Bank account"], toId: acc["Cash in hand"], details: "ATM withdrawal" });

      await expense(5, "Utilities", vary(6_800), "Electricity bill", "Bank account");
      await expense(6, "Utilities", vary(1_900), "Water bill", "Bank account");
      await expense(8, "Utilities", rs(3_499), "Mobile & internet", "Bank account");
      await expense(2, "Gym", rs(4_500), "Gym membership", "Bank account");
      for (const d of [4, 11, 18, 24]) await expense(d, "Groceries", vary(9_500 * scale), "Weekly groceries");
      for (const d of [2, 7, 9, 14, 16, 21, 23, 29]) await expense(d, "Food", vary(1_800), pick(rand, ["Lunch", "Kottu night", "Bakery", "Rice & curry"]));
      for (const d of [1, 10, 15, 20]) await expense(d, "Transportation", vary(3_200), pick(rand, ["Fuel", "PickMe ride", "Bus pass"]));
      if (m % 2 === 0) await expense(12, "Medicine", vary(2_600), "Pharmacy");
      if (m === 1) await expense(19, "Clothing", vary(12_000), "Office shirts", "Bank account");
      if (m === 2) await expense(13, "Fun & Vacation", vary(28_000 * scale), "Weekend in Ella", "Bank account");
      if (m === 2) await expense(22, "Gift", vary(5_000), "Birthday gift");
      await expense(14, "Body Care", vary(1_500), "Salon");
    }
    console.log(`  ${u.name}: ${count} demo transactions`);
  }

  await prisma.$disconnect();
  console.log("\nDemo database ready: data/demo.db");
  for (const u of DEMO_USERS) console.log(`  ${u.name.padEnd(14)} ${u.email.padEnd(18)} password: ${u.password}  PIN: ${u.pin}`);
  console.log("\nStart it with: npm run dev:demo\n");
}

/** Same "random" numbers every run, so demo videos look identical. */
function seededRandom(seed: number) {
  let s = seed * 2_654_435_761;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

function pick<T>(rand: () => number, items: T[]) {
  return items[Math.floor(rand() * items.length)];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
