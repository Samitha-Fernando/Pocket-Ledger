import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

// Builds a fresh, empty test database from the migrations before the test run.
export default function setup() {
  const url = "file:./data/test.db";
  mkdirSync("data", { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`data/test.db${suffix}`, { force: true });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
