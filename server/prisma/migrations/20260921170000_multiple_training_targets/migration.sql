-- A user can now be building toward several events at once, each with a
-- priority tier that decides how much of the season bends around it.

-- CreateEnum
CREATE TYPE "TargetPriority" AS ENUM ('A', 'B', 'C');

-- AlterTable: existing single targets become the season's A goal.
ALTER TABLE "TrainingTarget" ADD COLUMN "priority" "TargetPriority" NOT NULL DEFAULT 'A';

-- DropIndex: one target per user was the whole point of this constraint.
DROP INDEX "TrainingTarget_userId_key";

-- CreateIndex
CREATE INDEX "TrainingTarget_userId_date_idx" ON "TrainingTarget"("userId", "date");
