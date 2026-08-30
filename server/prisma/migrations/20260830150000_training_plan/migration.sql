-- CreateTable
CREATE TABLE "TrainingPlanConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL,
    "mondayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tuesdayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wednesdayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thursdayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fridayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturdayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sundayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "includeRunning" BOOLEAN NOT NULL DEFAULT false,
    "runDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlanConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isRestDay" BOOLEAN NOT NULL DEFAULT false,
    "restReason" TEXT,
    "sourcePath" TEXT,
    "name" TEXT,
    "discipline" "PlannedDiscipline",
    "durationMin" INTEGER,
    "intensity" INTEGER,
    "trainingStress" INTEGER,
    "profile" TEXT,
    "segments" JSONB,
    "category" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlanConfig_userId_key" ON "TrainingPlanConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedDay_userId_date_key" ON "PlannedDay"("userId", "date");

-- AddForeignKey
ALTER TABLE "TrainingPlanConfig" ADD CONSTRAINT "TrainingPlanConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedDay" ADD CONSTRAINT "PlannedDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
