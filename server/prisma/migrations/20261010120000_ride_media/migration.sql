-- CreateTable
CREATE TABLE "RideMedia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideMedia_userId_startedAt_idx" ON "RideMedia"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "RideMedia" ADD CONSTRAINT "RideMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
