-- CreateTable
CREATE TABLE "GarminSyncConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oauth1Token" TEXT NOT NULL,
    "oauth2Token" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarminSyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GarminSyncConfig_userId_key" ON "GarminSyncConfig"("userId");

-- AddForeignKey
ALTER TABLE "GarminSyncConfig" ADD CONSTRAINT "GarminSyncConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
