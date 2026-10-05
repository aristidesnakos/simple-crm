-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN "body" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "fromAddress" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "messageId" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "subject" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "toAddress" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "approach" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "sendVia" TEXT NOT NULL DEFAULT 'gmail',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("approach", "createdAt", "description", "fromEmail", "id", "name", "status", "updatedAt") SELECT "approach", "createdAt", "description", "fromEmail", "id", "name", "status", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_externalId_key" ON "Interaction"("externalId");

