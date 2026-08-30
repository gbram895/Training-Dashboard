import type { WorkoutType } from '@prisma/client';

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

export function stravaConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  if (!CLIENT_ID) throw new Error('STRAVA_CLIENT_ID is not set');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
}

export async function exchangeCodeForTokens(code: string): Promise<StravaTokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Strava app credentials are not set');
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<StravaTokenResponse>;
}

export async function refreshTokens(refreshToken: string): Promise<StravaTokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Strava app credentials are not set');
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<StravaTokenResponse>;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string; // ISO, UTC
  moving_time: number; // seconds
  distance: number; // meters
}

export async function listActivities(accessToken: string, page: number, perPage: number): Promise<StravaActivity[]> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava list activities failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<StravaActivity[]>;
}

interface StravaStreamSet {
  time?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  watts?: { data: number[] };
}

export interface StravaSample {
  offsetSec: number;
  heartRate?: number;
  speedMps?: number;
  powerWatts?: number;
}

export async function getActivityStreams(accessToken: string, activityId: number): Promise<StravaSample[]> {
  const params = new URLSearchParams({ keys: 'time,heartrate,velocity_smooth,watts', key_by_type: 'true' });
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Strava 404s streams for activities with no recorded data (manual entries) — that's not an error.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Strava streams fetch failed: ${res.status} ${await res.text()}`);

  const streams = (await res.json()) as StravaStreamSet;
  const time = streams.time?.data;
  if (!time || time.length === 0) return [];

  return time.map((offsetSec, i) => ({
    offsetSec,
    heartRate: streams.heartrate?.data[i],
    speedMps: streams.velocity_smooth?.data[i],
    powerWatts: streams.watts?.data[i] != null ? Math.round(streams.watts!.data[i]) : undefined,
  }));
}

// Calories only appear on the detailed activity representation, not the list
// endpoint — this costs one extra request per newly-imported activity.
export async function getActivityCalories(accessToken: string, activityId: number): Promise<number | undefined> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const detail = (await res.json()) as { calories?: number };
  return detail.calories;
}

const STRAVA_TYPE_MAP: Record<string, WorkoutType> = {
  run: 'RUN',
  trailrun: 'RUN',
  virtualrun: 'RUN',
  ride: 'RIDE',
  mountainbikeride: 'RIDE',
  gravelride: 'RIDE',
  virtualride: 'RIDE',
  ebikeride: 'RIDE',
  handcycle: 'RIDE',
  velomobile: 'RIDE',
  swim: 'SWIM',
  walk: 'WALK',
  hike: 'WALK',
  weighttraining: 'STRENGTH',
  workout: 'STRENGTH',
  crossfit: 'STRENGTH',
  badminton: 'BADMINTON',
};

export function mapStravaActivityType(sportType: string): WorkoutType {
  const key = sportType.toLowerCase().replace(/[^a-z]/g, '');
  return STRAVA_TYPE_MAP[key] ?? 'OTHER';
}

export function stravaExternalId(activityId: number): string {
  return `strava:${activityId}`;
}
