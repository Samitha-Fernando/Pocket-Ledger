import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

// Base (unscoped) database client.
// Only auth/admin code may use this directly. Feature code must use the
// user-scoped client from `getUserDb()` so it can never see other users' data.

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Reuse one client during development hot-reloads.
export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
