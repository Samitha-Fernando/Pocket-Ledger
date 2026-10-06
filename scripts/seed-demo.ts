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

  for (const u of DEMO_USERS) {
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
  }

  await prisma.$disconnect();
  console.log("\nDemo database ready: data/demo.db");
  for (const u of DEMO_USERS) console.log(`  ${u.name.padEnd(14)} ${u.email.padEnd(18)} password: ${u.password}  PIN: ${u.pin}`);
  console.log("\nStart it with: npm run dev:demo\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
