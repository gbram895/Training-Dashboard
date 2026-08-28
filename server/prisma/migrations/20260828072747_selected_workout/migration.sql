-- CreateEnum
CREATE TYPE "PlannedDiscipline" AS ENUM ('BIKE', 'RUN');

-- CreateTable
CREATE TABLE "SelectedWorkout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "PlannedDiscipline" NOT NULL,
    "durationMin" INTEGER,
    "intensity" INTEGER,
    "trainingStress" INTEGER,
    "profile" TEXT,
    "sourcePath" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelectedWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelectedWorkout_userId_key" ON "SelectedWorkout"("userId");

-- AddForeignKey
ALTER TABLE "SelectedWorkout" ADD CONSTRAINT "SelectedWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
