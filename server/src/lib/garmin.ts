import pkg from 'garmin-connect';
import type { WorkoutType } from '@prisma/client';
import type { HeartRateSample } from './appleHealth.js';

const { GarminConnect } = pkg;
export type GarminConnect = InstanceType<typeof GarminConnect>;

// The token shapes are Garmin/library internals we never inspect ourselves —
// we just persist and replay whatever the client hands back, opaquely.
export type GarminTokens = ReturnType<GarminConnect['exportToken']>;

export async function loginToGarmin(username: string, password: string): Promise<GarminTokens> {
  const client = new GarminConnect({ username, password });
  await client.login();
  return client.exportToken();
}

export function garminClientFromTokens(tokens: GarminTokens): GarminConnect {
  const client = new GarminConnect({ username: '', password: '' });
  client.loadToken(tokens.oauth1, tokens.oauth2);
  return client;
}

const GARMIN_TYPE_MAP: Record<string, WorkoutType> = {
  running: 'RUN',
  trail_running: 'RUN',
  treadmill_running: 'RUN',
  street_running: 'RUN',
  track_running: 'RUN',
  indoor_running: 'RUN',
  ultra_run: 'RUN',
  cycling: 'RIDE',
  road_biking: 'RIDE',
  mountain_biking: 'RIDE',
  gravel_cycling: 'RIDE',
  track_cycling: 'RIDE',
  indoor_cycling: 'RIDE',
  virtual_ride: 'RIDE',
  cyclocross: 'RIDE',
  e_bike_mountain: 'RIDE',
  e_bike_fitness: 'RIDE',
  bmx: 'RIDE',
  swimming: 'SWIM',
  lap_swimming: 'SWIM',
  open_water_swimming: 'SWIM',
  walking: 'WALK',
  casual_walking: 'WALK',
  speed_walking: 'WALK',
  strength_training: 'STRENGTH',
  badminton: 'BADMINTON',
};

export function mapGarminActivityType(typeKey: string): WorkoutType {
  return GARMIN_TYPE_MAP[typeKey] ?? 'OTHER';
}

export function garminExternalId(activityId: number | string): string {
  return `garmin:${activityId}`;
}

/** Garmin's startTimeGMT is "YYYY-MM-DD HH:mm:ss" with no timezone marker; it is always UTC. */
export function parseGarminGmtDate(startTimeGMT: string): Date {
  return new Date(`${startTimeGMT.replace(' ', 'T')}Z`);
}

interface GarminMetricDescriptor {
  metricsIndex: number;
  key: string;
}

interface GarminDetailMetric {
  metrics: number[];
}

interface GarminActivityDetailsResponse {
  metricDescriptors?: unknown[];
  activityDetailMetrics?: unknown[];
}

/**
 * Per-second (or so) chart data for an activity. This endpoint isn't part of the
 * garmin-connect package's typed surface, so it's called directly — the same
 * undocumented endpoint every unofficial Garmin Connect tool uses.
 */
export async function fetchGarminActivityDetails(
  client: GarminConnect,
  activityId: number,
): Promise<GarminActivityDetailsResponse> {
  return client.get<GarminActivityDetailsResponse>(
    `https://connectapi.garmin.com/activity-service/activity/${activityId}/details`,
  );
}

/**
 * Garmin's activityDetails response is a column-oriented table: metricDescriptors
 * says which index in each row holds which metric. Not documented anywhere in this
 * client, so this degrades to an empty array rather than throwing if the shape
 * doesn't match what's expected.
 */
export function extractGarminHeartRateSamples(details: GarminActivityDetailsResponse): HeartRateSample[] {
  try {
    if (!details.metricDescriptors || !details.activityDetailMetrics) return [];
    const descriptors = details.metricDescriptors as GarminMetricDescriptor[];
    const hrIdx = descriptors.find((d) => d.key === 'directHeartRate')?.metricsIndex;
    const tsIdx = descriptors.find((d) => d.key === 'directTimestamp')?.metricsIndex;
    if (hrIdx == null || tsIdx == null) return [];

    const rows = details.activityDetailMetrics as GarminDetailMetric[];
    const samples: HeartRateSample[] = [];
    for (const row of rows) {
      const hr = row.metrics[hrIdx];
      const ts = row.metrics[tsIdx];
      if (typeof hr === 'number' && typeof ts === 'number') {
        samples.push({ date: new Date(ts).toISOString(), Avg: hr });
      }
    }
    return samples;
  } catch {
    return [];
  }
}
