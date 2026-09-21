-- Moves the background schedules out of in-process timers and into the
-- database: a row per job holding when it is next due. Timers die with the
-- process, so nothing ran while the service was asleep and missed runs were
-- never made up. A due date in Postgres survives that, and is what lets a
-- tick after the gap see the run is still owed.
CREATE TABLE "ScheduledJob" (
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("name")
);

-- Every tick asks the same question: what is due now?
CREATE INDEX "ScheduledJob_nextRunAt_idx" ON "ScheduledJob"("nextRunAt");
