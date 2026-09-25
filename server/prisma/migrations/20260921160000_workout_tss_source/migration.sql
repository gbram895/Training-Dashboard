-- CreateEnum
CREATE TYPE "TssSource" AS ENUM ('POWER', 'PACE', 'HR');

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN "tssSource" "TssSource";
