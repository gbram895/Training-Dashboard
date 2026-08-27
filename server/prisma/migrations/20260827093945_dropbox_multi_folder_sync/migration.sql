/*
  Warnings:

  - You are about to drop the column `folderPath` on the `HealthSyncConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "HealthSyncConfig" DROP COLUMN "folderPath",
ADD COLUMN     "folderPaths" TEXT[] DEFAULT ARRAY['/Apps/Health Auto Export/Health Auto Export/Apple health', '/Apps/Health Auto Export/Health Auto Export/Apple Health Wourkouts']::TEXT[];

-- CreateTable
CREATE TABLE "SyncedDropboxFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "serverModified" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncedDropboxFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncedDropboxFile_userId_path_key" ON "SyncedDropboxFile"("userId", "path");

-- AddForeignKey
ALTER TABLE "SyncedDropboxFile" ADD CONSTRAINT "SyncedDropboxFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
