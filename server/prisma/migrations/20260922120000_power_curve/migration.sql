-- Best sustained power over a fixed set of durations, one row per (ride,
-- duration). Stored rather than derived on request: a year of per-second
-- samples is hundreds of thousands of rows, and a "best ever" curve would
-- otherwise walk all of them behind a page load.

CREATE TABLE "WorkoutPowerBest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "watts" INTEGER NOT NULL,

    CONSTRAINT "WorkoutPowerBest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkoutPowerBest_workoutId_durationSec_key" ON "WorkoutPowerBest"("workoutId", "durationSec");
CREATE INDEX "WorkoutPowerBest_userId_durationSec_date_idx" ON "WorkoutPowerBest"("userId", "durationSec", "date");

ALTER TABLE "WorkoutPowerBest" ADD CONSTRAINT "WorkoutPowerBest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutPowerBest" ADD CONSTRAINT "WorkoutPowerBest_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Null on every existing ride, which is what marks it as still to be
-- analysed. Deliberately not backfilled here: extracting the efforts means
-- reading each ride's samples, which is the rebuild's job and far too much
-- work for a migration that runs on boot.
ALTER TABLE "Workout" ADD COLUMN "powerBestsAt" TIMESTAMP(3);
