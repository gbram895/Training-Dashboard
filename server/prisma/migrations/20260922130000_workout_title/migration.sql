-- The name the source gave an activity ("Ventoux repeats", "Lunch Ride").
-- Garmin and Strava both send one on every activity, but until now it was
-- only kept for type OTHER, folded into `notes` — so a ride or run arrived
-- with its name thrown away. Search over the workout list needs that text,
-- so it gets its own column rather than being crammed into the athlete's
-- own notes, which are a different thing and are edited by hand.
--
-- Left NULL for everything already imported. POST /workouts/backfill-training-load
-- re-reads the Garmin and Strava activity lists and fills in what it can.
ALTER TABLE "Workout" ADD COLUMN "title" TEXT;
