-- AlterTable
ALTER TABLE "TrainingPlanConfig" ADD COLUMN "trainingWindows" JSONB;

-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "plannedStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appleId" TEXT,
    "appPasswordSealed" TEXT,
    "calendars" JSONB,
    "feedToken" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "planFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_key" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_feedToken_key" ON "CalendarConnection"("feedToken");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
