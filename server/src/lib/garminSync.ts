import { prisma } from './prisma.js';
import { computeHrZoneMinutes, type HrZoneThresholds } from './appleHealth.js';
import { beginGarminLogin, completeGarminMfaLogin } from './garminAuth.js';
import {
  extractGarminHeartRateSamples,
  fetchGarminActivityDetails,
  garminClientFromTokens,
  garminExternalId,
  mapGarminActivityType,
  newGarminClient,
  parseGarminGmtDate,
  type GarminConnect,
  type GarminTokens,
} from './garmin.js';

const RECENT_BATCH = 30;
const BACKFILL_PAGE_SIZE = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveGarminTokens(userId: string, tokens: GarminTokens) {
  await prisma.garminSyncConfig.upsert({
    where: { userId },
    create: { userId, oauth1Token: JSON.stringify(tokens.oauth1), oauth2Token: JSON.stringify(tokens.oauth2) },
    update: {
      oauth1Token: JSON.stringify(tokens.oauth1),
      oauth2Token: JSON.stringify(tokens.oauth2),
      lastSyncError: null,
    },
  });
}

export async function connectGarminAccountAndSave(userId: string, username: string, password: string) {
  const client = newGarminClient();
  const result = await beginGarminLogin(client, username, password);
  if (result.pendingId) return { mfaRequired: true as const, pendingId: result.pendingId };
  await saveGarminTokens(userId, result.tokens!);
  return { mfaRequired: false as const };
}

export async function completeGarminAccountConnect(userId: string, pendingId: string, code: string) {
  const tokens = await completeGarminMfaLogin(pendingId, code);
  await saveGarminTokens(userId, tokens);
}

interface GarminActivitySummary {
  activityId: number;
  activityName: string;
  startTimeGMT: string;
  duration: number;
  distance: number;
  activityType?: { typeKey: string };
}

async function importGarminActivity(
  userId: string,
  client: GarminConnect,
  activity: GarminActivitySummary,
  thresholds: HrZoneThresholds,
): Promise<boolean> {
  const externalId = garminExternalId(activity.activityId);
  const existing = await prisma.workout.findUnique({ where: { externalId } });
  if (existing) return false;

  const type = mapGarminActivityType(activity.activityType?.typeKey ?? '');
  const durationMin = Math.round(activity.duration / 60);
  const distanceKm = activity.distance ? activity.distance / 1000 : undefined;
  const date = parseGarminGmtDate(activity.startTimeGMT);

  let zoneFields = {};
  try {
    const details = await fetchGarminActivityDetails(client, activity.activityId);
    const samples = extractGarminHeartRateSamples(details);
    const zones = computeHrZoneMinutes(samples, date.toISOString(), thresholds);
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
    console.error(`[garmin-sync] failed to fetch HR details for activity ${activity.activityId}:`, err);
  }

  await prisma.workout.create({
    data: {
      userId,
      type,
      date,
      durationMin,
      distanceKm,
      notes: type === 'OTHER' ? activity.activityName : undefined,
      source: 'garmin',
      externalId,
      ...zoneFields,
    },
  });
  return true;
}

export async function runGarminSyncForUser(userId: string, options: { force?: boolean } = {}) {
  const config = await prisma.garminSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Garmin is not connected for this account');

  const totals = { activitiesSeen: 0, workoutsImported: 0 };

  try {
    const tokens: GarminTokens = {
      oauth1: JSON.parse(config.oauth1Token),
      oauth2: JSON.parse(config.oauth2Token),
    };
    const client = garminClientFromTokens(tokens);

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

    if (options.force) {
      let start = 0;
      for (;;) {
        const batch = (await client.getActivities(start, BACKFILL_PAGE_SIZE)) as GarminActivitySummary[];
        if (batch.length === 0) break;
        totals.activitiesSeen += batch.length;
        for (const activity of batch) {
          const created = await importGarminActivity(userId, client, activity, thresholds);
          if (created) {
            totals.workoutsImported += 1;
            await sleep(250);
          }
        }
        start += batch.length;
        if (batch.length < BACKFILL_PAGE_SIZE) break;
      }
    } else {
      const activities = (await client.getActivities(0, RECENT_BATCH)) as GarminActivitySummary[];
      totals.activitiesSeen = activities.length;
      for (const activity of activities) {
        const created = await importGarminActivity(userId, client, activity, thresholds);
        if (created) totals.workoutsImported += 1;
      }
    }

    const refreshed = client.exportToken();
    await prisma.garminSyncConfig.update({
      where: { userId },
      data: {
        oauth1Token: JSON.stringify(refreshed.oauth1),
        oauth2Token: JSON.stringify(refreshed.oauth2),
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });

    return totals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.garminSyncConfig.update({ where: { userId }, data: { lastSyncError: message } });
    throw err;
  }
}

export async function runAllGarminSyncs() {
  const configs = await prisma.garminSyncConfig.findMany({ select: { userId: true } });
  for (const { userId } of configs) {
    try {
      const result = await runGarminSyncForUser(userId);
      console.log(`[garmin-sync] user ${userId}:`, result);
    } catch (err) {
      console.error(`[garmin-sync] user ${userId} failed:`, err);
    }
  }
}
