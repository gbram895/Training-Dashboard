-- Apple Health's sleep_analysis entries have always carried a stage breakdown;
-- the importer only ever read totalSleep off them and dropped the rest. These
-- columns give the discarded detail somewhere to live. Left NULL for existing
-- rows on purpose: re-running the Apple Health import over the Dropbox exports
-- backfills them, and a night whose source never reported stages (a phone
-- rather than a watch) legitimately has none.

ALTER TABLE "DailyHealthSummary"
  ADD COLUMN "sleepDeepHours"  DOUBLE PRECISION,
  ADD COLUMN "sleepCoreHours"  DOUBLE PRECISION,
  ADD COLUMN "sleepRemHours"   DOUBLE PRECISION,
  ADD COLUMN "sleepAwakeHours" DOUBLE PRECISION,
  ADD COLUMN "sleepInBedHours" DOUBLE PRECISION,
  ADD COLUMN "sleepStart"      TIMESTAMP(3),
  ADD COLUMN "sleepEnd"        TIMESTAMP(3),
  ADD COLUMN "sleepSource"     TEXT,
  ADD COLUMN "sleepingWristTempC" DOUBLE PRECISION,
  ADD COLUMN "sleepRespiratoryRate" DOUBLE PRECISION;

-- Nudge every already-imported Apple Health export to be read again, once.
-- The stage detail for the whole history is sitting in the Dropbox files that
-- have already been downloaded; without this the columns above would only ever
-- fill in for nights exported after the deploy, and the sleep view would be
-- empty for weeks. Re-importing is idempotent — daily summaries upsert and
-- workouts dedupe on externalId — so the only cost is one slower sync run.
UPDATE "SyncedDropboxFile" SET "serverModified" = TIMESTAMP '1970-01-01 00:00:00';
