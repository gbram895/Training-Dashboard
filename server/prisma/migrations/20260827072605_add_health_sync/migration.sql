-- CreateTable
CREATE TABLE "DailyHealthSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "steps" INTEGER,
    "distanceKm" REAL,
    "activeEnergyKcal" REAL,
    "avgHeartRate" REAL,
    "restingHeartRate" REAL,
    "sleepHours" REAL,
    "exerciseMinutes" REAL,
    "flightsClimbed" INTEGER,
    "vo2Max" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyHealthSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Workout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "distanceKm" REAL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Workout" ("createdAt", "date", "distanceKm", "durationMin", "id", "notes", "type", "userId") SELECT "createdAt", "date", "distanceKm", "durationMin", "id", "notes", "type", "userId" FROM "Workout";
DROP TABLE "Workout";
ALTER TABLE "new_Workout" RENAME TO "Workout";
CREATE UNIQUE INDEX "Workout_externalId_key" ON "Workout"("externalId");
CREATE INDEX "Workout_userId_date_idx" ON "Workout"("userId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DailyHealthSummary_userId_date_key" ON "DailyHealthSummary"("userId", "date");
