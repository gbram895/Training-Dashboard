-- A goal now says what kind of event it is, not just when it is and how much
-- it matters. That is what lets the plan pick sessions that train FOR the
-- event rather than merely scaling hours around it.

-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM (
  'GENERAL',
  'LONG_RIDE',
  'HILLY_RIDE',
  'RACE_RIDE',
  'TIME_TRIAL',
  'GRAVEL_MTB',
  'RUN_SHORT',
  'RUN_LONG',
  'TRAIL_ULTRA',
  'MULTISPORT'
);

-- AlterTable: existing goals keep today's behaviour until the athlete says
-- what they are — GENERAL is "no particular event", which is exactly how the
-- plan treated every goal before this column existed.
ALTER TABLE "TrainingTarget" ADD COLUMN "kind" "GoalKind" NOT NULL DEFAULT 'GENERAL';

-- AlterTable: one line explaining which demand of which goal a day is training.
ALTER TABLE "PlannedDay" ADD COLUMN "focus" TEXT;
