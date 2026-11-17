-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('GRADIENT', 'INTERVALS');

-- AlterTable
ALTER TABLE "TrainingPlanConfig" ADD COLUMN "planSource" "PlanSource" NOT NULL DEFAULT 'GRADIENT';

-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "externalId" TEXT,
ADD COLUMN "readinessWarning" TEXT;

-- CreateTable
CREATE TABLE "IntervalsConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL DEFAULT '0',
    "apiKeySealed" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastEventCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntervalsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntervalsConnection_userId_key" ON "IntervalsConnection"("userId");

-- AddForeignKey
ALTER TABLE "IntervalsConnection" ADD CONSTRAINT "IntervalsConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
