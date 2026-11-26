-- AlterTable
ALTER TABLE "Account" ADD COLUMN "currency" TEXT;

-- AlterTable
ALTER TABLE "EntryLine" ADD COLUMN "foreignAmount" BIGINT;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "rate4" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExchangeRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExchangeRate_userId_currency_date_idx" ON "ExchangeRate"("userId", "currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_userId_currency_date_key" ON "ExchangeRate"("userId", "currency", "date");
