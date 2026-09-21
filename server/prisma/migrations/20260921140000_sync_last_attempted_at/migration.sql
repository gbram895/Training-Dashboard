-- Records when a sync last ran, whether it succeeded or not. "lastSyncedAt"
-- only moves on success, so on its own it cannot say whether a failure is
-- minutes old or weeks old, nor whether the most recent run failed at all.
ALTER TABLE "HealthSyncConfig" ADD COLUMN "lastAttemptedAt" TIMESTAMP(3);
ALTER TABLE "GarminSyncConfig" ADD COLUMN "lastAttemptedAt" TIMESTAMP(3);
ALTER TABLE "StravaSyncConfig" ADD COLUMN "lastAttemptedAt" TIMESTAMP(3);
