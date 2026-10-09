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
    // activity:write lets IndoorWarior's indoor rides be uploaded through Gradient.
    scope: 'activity:read_all,activity:write',
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

export interface StravaUpload {
  id: number;
  status: string;
  error: string | null;
  activity_id: number | null;
}

export class StravaUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function uploadRequest(accessToken: string, path: string, init?: RequestInit): Promise<StravaUpload> {
  const res = await fetch(`https://www.strava.com/api/v3/uploads${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new StravaUploadError(`Strava upload failed: ${res.status} ${await res.text()}`, res.status);
  return res.json() as Promise<StravaUpload>;
}

/**
 * Uploads a FIT activity and waits briefly for Strava to process it. Strava
 * processes uploads asynchronously; if it is still working after the wait,
 * the upload is returned without an activity id and will finish on its own.
 */
export async function uploadFitActivity(
  accessToken: string,
  file: Buffer,
  opts: { name: string; externalId: string; trainer?: boolean },
): Promise<StravaUpload> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), `${opts.externalId}.fit`);
  form.append('data_type', 'fit');
  form.append('name', opts.name);
  // Only ever send trainer=1: a ride that is not a trainer ride leaves the
  // field out, and is unflagged again below once Strava has made it.
  if (opts.trainer !== false) form.append('trainer', '1');
  form.append('external_id', opts.externalId);

  let upload = await uploadRequest(accessToken, '', { method: 'POST', body: form });
  for (let i = 0; i < 8 && !upload.activity_id && !upload.error; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    upload = await uploadRequest(accessToken, `/${upload.id}`);
  }
  if (opts.trainer === false && !upload.error) void clearTrainerWhenReady(accessToken, upload);
  return upload;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits, in the background, for Strava to finish an upload it was still
 * processing when the request returned, then clears its trainer flag. Strava
 * often takes longer than the request waits.
 */
async function clearTrainerWhenReady(accessToken: string, upload: StravaUpload): Promise<void> {
  try {
    for (let i = 0; i < 60 && !upload.activity_id && !upload.error; i++) {
      await sleep(3000);
      upload = await uploadRequest(accessToken, `/${upload.id}`);
    }
    if (upload.activity_id) await markNotTrainer(accessToken, upload.activity_id);
    else console.error(`[strava] upload ${upload.id} never produced an activity: ${upload.error ?? upload.status}`);
  } catch (err) {
    console.error(`[strava] could not follow upload ${upload.id}:`, err);
  }
}

export interface TrainerFlagResult {
  /** Strava's trainer flag after the last attempt, or null if it could not be read. */
  trainer: boolean | null;
  /** Strava's own words when it refused, for showing to the rider. */
  error?: string;
}

/**
 * Strava hides the map and elevation of a trainer ride, and a route ride from
 * IndoorWarior has both. Strava flags such uploads as trainer rides even with
 * the upload's trainer field left out, so the flag is cleared on the activity
 * itself, then checked again a little later in case Strava's own processing
 * sets it back. Best effort: a failure here leaves a ride without its map,
 * not a failed upload.
 */
export async function markNotTrainer(accessToken: string, activityId: number, recheckMs = 20_000): Promise<TrainerFlagResult> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;
  let result: TrainerFlagResult = { trainer: null };
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ trainer: false }) });
      if (!res.ok) {
        const error = `${res.status} ${await res.text()}`;
        console.error(`[strava] could not clear trainer flag on ${activityId}: ${error}`);
        return { trainer: null, error };
      }
      const updated = (await res.json()) as { trainer?: boolean };
      result = { trainer: updated.trainer ?? null };
      await sleep(recheckMs);
      const check = await fetch(url, { headers });
      if (!check.ok) return result;
      const activity = (await check.json()) as { trainer?: boolean };
      result = { trainer: activity.trainer ?? null };
      if (activity.trainer !== true) return result;
      console.warn(`[strava] ${activityId} still flagged as a trainer ride after attempt ${attempt}`);
    }
  } catch (err) {
    console.error(`[strava] could not clear trainer flag on ${activityId}:`, err);
    return { ...result, error: err instanceof Error ? err.message : String(err) };
  }
  return result;
}

/** The activity an upload became, waiting up to `waitMs` for Strava to finish it. */
export async function uploadActivityId(accessToken: string, uploadId: number, waitMs: number): Promise<StravaUpload> {
  let upload = await uploadRequest(accessToken, `/${uploadId}`);
  for (const until = Date.now() + waitMs; !upload.activity_id && !upload.error && Date.now() < until; ) {
    await sleep(2000);
    upload = await uploadRequest(accessToken, `/${uploadId}`);
  }
  return upload;
}
