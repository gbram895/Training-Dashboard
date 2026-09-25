-- A multisport goal is really two events on the same day. A sprint duathlon
-- and a long-course triathlon share a GoalKind and almost no training, so each
-- leg now carries its own kind and trains to its own demands.

-- AlterTable: null on every goal that isn't MULTISPORT, including the ones
-- already stored — a multisport goal with no legs set falls back to the
-- middle-distance defaults in lib/goalSpecificity.ts.
ALTER TABLE "TrainingTarget" ADD COLUMN "bikeKind" "GoalKind";
ALTER TABLE "TrainingTarget" ADD COLUMN "runKind" "GoalKind";
