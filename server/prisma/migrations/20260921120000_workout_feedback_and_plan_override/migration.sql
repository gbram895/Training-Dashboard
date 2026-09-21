-- AlterTable
ALTER TABLE "Workout" ADD COLUMN "rpe" INTEGER,
ADD COLUMN "feedbackNotes" TEXT;

-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "manualOverride" BOOLEAN NOT NULL DEFAULT false;
