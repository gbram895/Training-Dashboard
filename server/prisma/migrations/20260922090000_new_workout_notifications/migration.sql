-- Tracks which library files the athlete has already been told about, so a
-- newly uploaded workout can be notified exactly once.

ALTER TABLE "CachedLibraryWorkout"
  ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Left NULL on purpose. The first check after this deploy sets it and
-- marks whatever is in the folder as already-announced, which is the only
-- way to get a correct baseline for a connection whose library cache is
-- empty (nothing has ever read it) as well as for one that is populated.
ALTER TABLE "HealthSyncConfig"
  ADD COLUMN "libraryBaselineAt" TIMESTAMP(3);
