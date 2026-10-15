-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT,
    "kind" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "rateBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "ratePeriod" TEXT NOT NULL DEFAULT 'YEAR',
    "creditLimit" BIGINT,
    "dueDay" INTEGER,
    "monthlyPayment" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedDate" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Debt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Debt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "depMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Entry" ("assetId", "createdAt", "date", "depMonth", "details", "id", "kind", "loanId", "updatedAt", "userId") SELECT "assetId", "createdAt", "date", "depMonth", "details", "id", "kind", "loanId", "updatedAt", "userId" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
CREATE INDEX "Entry_userId_date_idx" ON "Entry"("userId", "date");
CREATE UNIQUE INDEX "Entry_assetId_depMonth_key" ON "Entry"("assetId", "depMonth");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Debt_accountId_key" ON "Debt"("accountId");

-- CreateIndex
CREATE INDEX "Debt_userId_status_idx" ON "Debt"("userId", "status");
