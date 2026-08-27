-- CreateTable
CREATE TABLE "HealthSyncConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dropboxRefreshToken" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL DEFAULT '/Apps/Health Auto Export/Health Auto Export/Apple health',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthSyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthSyncConfig_userId_key" ON "HealthSyncConfig"("userId");

-- AddForeignKey
ALTER TABLE "HealthSyncConfig" ADD CONSTRAINT "HealthSyncConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
