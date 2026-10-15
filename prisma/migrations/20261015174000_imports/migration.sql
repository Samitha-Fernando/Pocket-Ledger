-- AlterTable
ALTER TABLE "User" ADD COLUMN "lateIncomeDay" INTEGER;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "accountId" TEXT,
    "startingBalance" BIGINT,
    "startingDate" TEXT,
    "openingEntryId" TEXT,
    "mapping" TEXT NOT NULL DEFAULT '{}',
    "lateIncomeDay" INTEGER,
    "postedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "date" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" BIGINT,
    "details" TEXT,
    "action" TEXT NOT NULL DEFAULT 'REVIEW',
    "targetId" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "assetName" TEXT,
    "assetClass" TEXT,
    "lifeMonths" INTEGER,
    "loanId" TEXT,
    "note" TEXT,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ImportRow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "details" TEXT,
    "assetId" TEXT,
    "loanId" TEXT,
    "debtId" TEXT,
    "importRowId" TEXT,
    "depMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Entry" ("assetId", "createdAt", "date", "debtId", "depMonth", "details", "id", "kind", "loanId", "updatedAt", "userId") SELECT "assetId", "createdAt", "date", "debtId", "depMonth", "details", "id", "kind", "loanId", "updatedAt", "userId" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
CREATE UNIQUE INDEX "Entry_importRowId_key" ON "Entry"("importRowId");
CREATE INDEX "Entry_userId_date_idx" ON "Entry"("userId", "date");
CREATE UNIQUE INDEX "Entry_assetId_depMonth_key" ON "Entry"("assetId", "depMonth");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_rowNumber_idx" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRow_userId_fingerprint_idx" ON "ImportRow"("userId", "fingerprint");
