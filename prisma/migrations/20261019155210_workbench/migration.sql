-- CreateTable
CREATE TABLE "EntryChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntryChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "contains" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ANY',
    "categoryId" TEXT,
    "assetId" TEXT,
    "loanId" TEXT,
    "accountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EntryChange_userId_entryId_idx" ON "EntryChange"("userId", "entryId");

-- CreateIndex
CREATE INDEX "EntryChange_userId_action_createdAt_idx" ON "EntryChange"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "Rule_userId_idx" ON "Rule"("userId");
