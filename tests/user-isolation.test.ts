import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { USER_OWNED_MODELS, scopedDb } from "@/lib/db/scoped";

// Proves that one user can never read or change another user's data
// through the scoped database client that all feature code uses.

let alice: string;
let bob: string;
let bobLogId: string;

beforeAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  alice = (await prisma.user.create({ data: { name: "Alice", email: "alice@example.test", passwordHash: "x" } })).id;
  bob = (await prisma.user.create({ data: { name: "Bob", email: "bob@example.test", passwordHash: "x" } })).id;
  await prisma.auditLog.createMany({
    data: [
      { userId: alice, action: "alice-1" },
      { userId: alice, action: "alice-2" },
      { userId: bob, action: "bob-1" },
    ],
  });
  bobLogId = (await prisma.auditLog.findFirstOrThrow({ where: { userId: bob } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("scoped database client", () => {
  it("lists only the signed-in user's rows", async () => {
    const rows = await scopedDb(prisma, alice).auditLog.findMany();
    expect(rows.map((r) => r.action).sort()).toEqual(["alice-1", "alice-2"]);
    expect(await scopedDb(prisma, alice).auditLog.count()).toBe(2);
  });

  it("can't fetch another user's row even by its exact id", async () => {
    const db = scopedDb(prisma, alice);
    expect(await db.auditLog.findUnique({ where: { id: bobLogId } })).toBeNull();
    expect(await db.auditLog.findFirst({ where: { id: bobLogId } })).toBeNull();
  });

  it("can't update or delete another user's row", async () => {
    const db = scopedDb(prisma, alice);
    await expect(db.auditLog.update({ where: { id: bobLogId }, data: { action: "hacked" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: bobLogId } })).rejects.toThrow();
    expect((await db.auditLog.updateMany({ where: { id: bobLogId }, data: { action: "hacked" } })).count).toBe(0);
    expect((await db.auditLog.deleteMany({ where: { id: bobLogId } })).count).toBe(0);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: bobLogId } })).action).toBe("bob-1");
  });

  it("always saves new rows under the signed-in user", async () => {
    const db = scopedDb(prisma, alice);
    const row = await db.auditLog.create({ data: { action: "alice-3" } as never });
    expect(row.userId).toBe(alice);
    await expect(db.auditLog.create({ data: { action: "sneaky", userId: bob } })).rejects.toThrow(/another user/);
  });

  it("refuses to move a row to another owner", async () => {
    const db = scopedDb(prisma, alice);
    await expect(db.auditLog.updateMany({ data: { userId: bob } })).rejects.toThrow(/owner/);
  });
});

describe("schema guard", () => {
  it("every table with a userId column is protected by the scoped client", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const models = [...schema.matchAll(/model (\w+) \{([^}]*)\}/g)]
      .filter(([, , body]) => /^\s*userId\s+String/m.test(body))
      .map(([, name]) => name);
    // Session belongs to the sign-in system itself, not to a user's finances.
    const AUTH_MODELS = ["Session"];
    const unprotected = models.filter(
      (m) => !AUTH_MODELS.includes(m) && !(USER_OWNED_MODELS as readonly string[]).includes(m),
    );
    expect(unprotected).toEqual([]);
  });
});
