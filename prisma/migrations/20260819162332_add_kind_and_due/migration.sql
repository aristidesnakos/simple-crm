-- AlterTable
ALTER TABLE "Project" ADD COLUMN "fromEmail" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'customer',
    "status" TEXT NOT NULL DEFAULT 'Prospect',
    "labels" TEXT,
    "lastContact" DATETIME,
    "nextAction" TEXT,
    "nextActionDue" DATETIME,
    "notes" TEXT,
    "draftLink" TEXT,
    "notesLink" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("createdAt", "draftLink", "email", "id", "labels", "lastContact", "name", "nextAction", "notes", "notesLink", "projectId", "status", "updatedAt") SELECT "createdAt", "draftLink", "email", "id", "labels", "lastContact", "name", "nextAction", "notes", "notesLink", "projectId", "status", "updatedAt" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
