-- CreateTable
CREATE TABLE "CachedLibraryWorkout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "serverModified" TIMESTAMP(3) NOT NULL,
    "thresholdsKey" TEXT NOT NULL,
    "parsed" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CachedLibraryWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CachedLibraryWorkout_userId_path_key" ON "CachedLibraryWorkout"("userId", "path");

-- AddForeignKey
ALTER TABLE "CachedLibraryWorkout" ADD CONSTRAINT "CachedLibraryWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
