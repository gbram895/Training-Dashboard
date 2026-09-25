-- AlterTable
ALTER TABLE "PlannedDay" ADD COLUMN "phase" TEXT,
ADD COLUMN "phaseWeek" INTEGER,
ADD COLUMN "loadMultiplier" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TrainingTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "peakCtl" DOUBLE PRECISION,
    "rampPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "recoveryEveryNWeeks" INTEGER NOT NULL DEFAULT 4,
    "recoveryMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "taperDays" INTEGER NOT NULL DEFAULT 10,
    "taperFloor" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "startedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTarget_userId_key" ON "TrainingTarget"("userId");

-- AddForeignKey
ALTER TABLE "TrainingTarget" ADD CONSTRAINT "TrainingTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
