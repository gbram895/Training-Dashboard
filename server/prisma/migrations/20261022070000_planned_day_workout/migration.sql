-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "workoutId" TEXT;

-- AddForeignKey
ALTER TABLE "PlannedDay" ADD CONSTRAINT "PlannedDay_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
