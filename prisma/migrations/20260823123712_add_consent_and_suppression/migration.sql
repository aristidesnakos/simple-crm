-- AlterTable
ALTER TABLE "Account" ADD COLUMN "consentedAt" DATETIME;
ALTER TABLE "Account" ADD COLUMN "jurisdiction" TEXT;
ALTER TABLE "Account" ADD COLUMN "sourceDetail" TEXT;
ALTER TABLE "Account" ADD COLUMN "sourceType" TEXT;

-- CreateTable
CREATE TABLE "Suppression" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "optedOutAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
