import { prisma } from "@/lib/db/client";

/** Empties the throw-away test database, children before parents. */
export async function resetDb() {
  await prisma.entryLine.deleteMany();
  await prisma.entry.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.fixedAsset.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.debt.deleteMany();
  await prisma.account.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}
