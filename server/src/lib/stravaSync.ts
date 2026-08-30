import { prisma } from './prisma.js';
import { computeHrZoneMinutesFromOffsets, type HrZoneThresholds } from './appleHealth.js';
import { createDedupedWorkout } from './workoutDedup.js';
import {
  exchangeCodeForTokens,
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
  }

  return createDedupedWorkout({
    userId,
    type,
    date,
    durationMin,
    distanceKm,
    notes: type === 'OTHER' ? activity.name : undefined,
    source: 'strava',
    externalId,
    zoneFields,
    samples,
  });
}

type StravaSampleWithZone = { offsetSec: number; heartRate?: number; speedMps?: number; powerWatts?: number };

export async function runStravaSyncForUser(userId: string, options: { force?: boolean } = {}) {
  const config = await prisma.stravaSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Strava is not connected for this account');

  const totals = { activitiesSeen: 0, workoutsImported: 0 };

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
        const result = await importStravaActivity(userId, accessToken, activity, thresholds);
        if (result === 'created' || result === 'replaced-duplicate') {
          totals.workoutsImported += 1;
          await sleep(150);
        }
      }

      if (!options.force || batch.length < pageSize) break;
      page += 1;
    }

    await prisma.stravaSyncConfig.update({
      where: { userId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });

    return totals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.stravaSyncConfig.update({ where: { userId }, data: { lastSyncError: message } });
    throw err;
  }
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
