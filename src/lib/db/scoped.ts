import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Tables that hold a user's own data. Every query against these through the
 * scoped client is automatically limited to one user. When you add a model
 * with a `userId` column, add it here (a test fails if you forget).
 */
export const USER_OWNED_MODELS = ["AuditLog", "Account", "Entry", "EntryLine", "FixedAsset", "Loan", "Debt", "ImportBatch", "ImportRow", "EntryChange", "Rule", "Budget", "BudgetDraft", "ExchangeRate"] as const;

const OWNED = new Set<string>(USER_OWNED_MODELS);

// Operations whose `where` gets `userId` added.
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function stamp(data: unknown, userId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stamp(d, userId));
  const row = { ...(data as Record<string, unknown>) };
  if (row.userId !== undefined && row.userId !== userId) {
    throw new Error("Cannot write data for another user");
  }
  if ("user" in row) throw new Error("Set ownership via the scoped client, not `user`");
  row.userId = userId;
  return row;
}

function guardUpdate(data: unknown) {
  const row = data as Record<string, unknown> | undefined;
  if (row && ("userId" in row || "user" in row)) {
    throw new Error("Cannot change the owner of a record");
  }
}

/** Rewrites query args so they only touch `userId`'s rows. Exported for tests. */
export function scopeArgs(model: string, operation: string, args: Args, userId: string): Args {
  if (!OWNED.has(model)) return args;
  const a: Args = { ...args };

  if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), userId };
    if (operation.startsWith("update")) guardUpdate(a.data);
    return a;
  }
  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
      a.data = stamp(a.data, userId);
      return a;
    case "upsert":
      a.where = { ...(a.where ?? {}), userId };
      a.create = stamp(a.create, userId) as Record<string, unknown>;
      guardUpdate(a.update);
      return a;
    default:
      throw new Error(`Operation ${operation} is not allowed on ${model} via the scoped client`);
  }
}

/** A database client that can only read and write one user's data. */
export function scopedDb(base: PrismaClient, userId: string) {
  return base.$extends({
    name: "user-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, userId) as typeof args);
        },
      },
    },
  });
}

export type UserDb = ReturnType<typeof scopedDb>;
