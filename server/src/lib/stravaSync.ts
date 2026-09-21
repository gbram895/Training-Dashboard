import { prisma } from './prisma.js';
import { computeHrZoneMinutesFromOffsets, type HrZoneThresholds } from './appleHealth.js';
import { createDedupedWorkout } from './workoutDedup.js';
import { recomputeTrainingLoad } from './trainingLoad.js';
import {
  exchangeCodeForTokens,
  getActivityCalories,
  getActivityStreams,
  listActivities,
  mapStravaActivityType,
  refreshTokens,
  stravaExternalId,
  type StravaActivity,
  type StravaTokenResponse,
} from './strava.js';

const RECENT_PAGE_SIZE = 30;
const BACKFILL_PAGE_SIZE = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveTokens(userId: string, tokens: StravaTokenResponse) {
  await prisma.stravaSyncConfig.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expires_at * 1000),
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expires_at * 1000),
      lastSyncError: null,
    },
  });
}

export async function connectStravaAccount(userId: string, code: string) {
  const tokens = await exchangeCodeForTokens(code);
  await saveTokens(userId, tokens);
}

async function getValidAccessToken(userId: string, config: { accessToken: string; refreshToken: string; expiresAt: Date }) {
  if (config.expiresAt.getTime() > Date.now() + 5 * 60_000) return config.accessToken;
  const refreshed = await refreshTokens(config.refreshToken);
  await saveTokens(userId, refreshed);
  return refreshed.access_token;
}

async function importStravaActivity(
  userId: string,
  accessToken: string,
  activity: StravaActivity,
  thresholds: HrZoneThresholds,
  failures: string[],
): Promise<'created' | 'replaced-duplicate' | 'skipped-duplicate' | 'skipped-existing'> {
  const externalId = stravaExternalId(activity.id);
  const existing = await prisma.workout.findUnique({ where: { externalId } });
  if (existing) return 'skipped-existing';

  const type = mapStravaActivityType(activity.sport_type || activity.type);
  const durationMin = Math.round(activity.moving_time / 60);
  const distanceKm = activity.distance ? activity.distance / 1000 : undefined;
  const date = new Date(activity.start_date);

  let samples: StravaSampleWithZone[] = [];
  let zoneFields = {};
  try {
    samples = await getActivityStreams(accessToken, activity.id);
    const zones = computeHrZoneMinutesFromOffsets(samples, activity.moving_time, thresholds);
    if (zones) {
      zoneFields = {
        hrZone1Min: zones.z1,
        hrZone2Min: zones.z2,
        hrZone3Min: zones.z3,
        hrZone4Min: zones.z4,
        hrZone5Min: zones.z5,
      };
    }
  } catch (err) {
    console.error(`[strava-sync] failed to fetch streams for activity ${activity.id}:`, err);
    // The workout still imports, but without HR zones or samples — say so
    // rather than leaving a silently degraded activity on the dashboard.
    failures.push(`${activity.name}: no heart-rate detail (${err instanceof Error ? err.message : String(err)})`);
  }

  let calorieKcal: number | undefined;
  try {
    calorieKcal = await getActivityCalories(accessToken, activity.id);
  } catch (err) {
    console.error(`[strava-sync] failed to fetch calories for activity ${activity.id}:`, err);
  }

  const result = await createDedupedWorkout({
    userId,
    type,
    date,
    durationMin,
    distanceKm,
    notes: type === 'OTHER' ? activity.name : undefined,
    source: 'strava',
    externalId,
    calorieKcal,
    zoneFields,
    samples,
  });

  if (result.workoutId) await recomputeTrainingLoad(result.workoutId);

  return result.outcome;
}

type StravaSampleWithZone = { offsetSec: number; heartRate?: number; speedMps?: number; powerWatts?: number };

const MAX_REPORTED_FAILURES = 3;

/** Null when every activity came through whole, otherwise a message short enough for the sync bar. */
function summariseFailures(failures: string[]): string | null {
  if (failures.length === 0) return null;
  const shown = failures.slice(0, MAX_REPORTED_FAILURES).join('; ');
  const rest = failures.length - MAX_REPORTED_FAILURES;
  return `${failures.length} activity/activities imported incomplete — ${shown}${rest > 0 ? ` (+${rest} more)` : ''}`;
}

export async function runStravaSyncForUser(userId: string, options: { force?: boolean } = {}) {
  const config = await prisma.stravaSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Strava is not connected for this account');

  const totals = { activitiesSeen: 0, workoutsImported: 0, activitiesDegraded: 0 };
  const failures: string[] = [];

  try {
    const accessToken = await getValidAccessToken(userId, config);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { hrZone1Max: true, hrZone2Max: true, hrZone3Max: true, hrZone4Max: true },
    });
    const thresholds: HrZoneThresholds = {
      z1Max: user.hrZone1Max,
      z2Max: user.hrZone2Max,
      z3Max: user.hrZone3Max,
      z4Max: user.hrZone4Max,
    };

    const pageSize = options.force ? BACKFILL_PAGE_SIZE : RECENT_PAGE_SIZE;
    let page = 1;
    for (;;) {
      const batch = await listActivities(accessToken, page, pageSize);
      if (batch.length === 0) break;
      totals.activitiesSeen += batch.length;

      for (const activity of batch) {
        const result = await importStravaActivity(userId, accessToken, activity, thresholds, failures);
        if (result === 'created' || result === 'replaced-duplicate') {
          totals.workoutsImported += 1;
          await sleep(150);
        }
      }

      if (!options.force || batch.length < pageSize) break;
      page += 1;
    }

    const now = new Date();
    await prisma.stravaSyncConfig.update({
      where: { userId },
      data: { lastSyncedAt: now, lastAttemptedAt: now, lastSyncError: summariseFailures(failures) },
    });

    totals.activitiesDegraded = failures.length;
    return totals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.stravaSyncConfig.update({
      where: { userId },
      data: { lastAttemptedAt: new Date(), lastSyncError: message },
    });
    throw err;
  }
}

const CALORIE_BACKFILL_LIMIT = 100;

/** One-off backfill for activities imported before calories were tracked — re-fetches each activity's own detail record. */
export async function backfillStravaCalories(userId: string): Promise<number> {
  const config = await prisma.stravaSyncConfig.findUnique({ where: { userId } });
  if (!config) return 0;
  const accessToken = await getValidAccessToken(userId, config);

  const workouts = await prisma.workout.findMany({
    where: { userId, source: 'strava', calorieKcal: null, externalId: { not: null } },
    take: CALORIE_BACKFILL_LIMIT,
  });

  let updated = 0;
  for (const w of workouts) {
    const activityId = Number(w.externalId!.split(':')[1]);
    if (!Number.isFinite(activityId)) continue;
    try {
      const calories = await getActivityCalories(accessToken, activityId);
      if (calories != null) {
        await prisma.workout.update({ where: { id: w.id }, data: { calorieKcal: calories } });
        updated += 1;
      }
    } catch (err) {
      console.error(`[strava-sync] calorie backfill failed for activity ${activityId}:`, err);
    }
    await sleep(150);
  }
  return updated;
}

export async function runAllStravaSyncs() {
  const configs = await prisma.stravaSyncConfig.findMany({ select: { userId: true } });
  for (const { userId } of configs) {
    try {
      const result = await runStravaSyncForUser(userId);
      console.log(`[strava-sync] user ${userId}:`, result);
    } catch (err) {
      console.error(`[strava-sync] user ${userId} failed:`, err);
    }
  }
}
