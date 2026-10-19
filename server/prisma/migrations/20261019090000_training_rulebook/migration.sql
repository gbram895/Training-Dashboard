-- CreateEnum
CREATE TYPE "TrainingLevel" AS ENUM ('RECREATIONAL', 'COMPETITIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "trainingLevel" "TrainingLevel" NOT NULL DEFAULT 'RECREATIONAL';

-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "templateId" TEXT,
ADD COLUMN "confidence" TEXT,
ADD COLUMN "confidenceNote" TEXT;
