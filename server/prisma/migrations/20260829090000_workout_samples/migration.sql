-- CreateTable
CREATE TABLE "WorkoutSample" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "offsetSec" INTEGER NOT NULL,
    "heartRate" INTEGER,
    "speedMps" DOUBLE PRECISION,
    "powerWatts" INTEGER,

    CONSTRAINT "WorkoutSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutSample_workoutId_offsetSec_idx" ON "WorkoutSample"("workoutId", "offsetSec");

-- AddForeignKey
ALTER TABLE "WorkoutSample" ADD CONSTRAINT "WorkoutSample_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
