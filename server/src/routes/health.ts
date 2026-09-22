import { Router, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import type { HealthAutoExportFile } from '../lib/appleHealth.js';
import { applyHealthFiles } from '../lib/healthImport.js';
import { buildAuthorizeUrl, dropboxConfigured, exchangeCodeForTokens } from '../lib/dropbox.js';
import { completeGarminAccountConnect, connectGarminAccountAndSave, runGarminSyncForUser } from '../lib/garminSync.js';
import { pushWorkoutToGarmin } from '../lib/garminWorkoutPush.js';
import { friendlyGarminAuthError } from '../lib/garminAuth.js';
import { buildAuthorizeUrl as buildStravaAuthorizeUrl, stravaConfigured } from '../lib/strava.js';
import { connectStravaAccount, runStravaSyncForUser } from '../lib/stravaSync.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

const router = Router();

router.get('/summary', requireAuth, async (req: AuthedRequest, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 183);

  const days = await prisma.dailyHealthSummary.findMany({
    where: { userId: req.userId, date: { gte: since } },
    orderBy: { date: 'asc' },
  });
  res.json(days);
});

const metricEntrySchema = z
  .object({
    date: z.string(),
    source: z.string().optional(),
    qty: z.number().optional(),
    Avg: z.number().optional(),
    Min: z.number().optional(),
    Max: z.number().optional(),
    totalSleep: z.number().optional(),
  })
  .passthrough();

const fileSchema = z.object({
  data: z.object({
    metrics: z
      .array(
        z.object({
          name: z.string(),
          units: z.string(),
          data: z.array(metricEntrySchema),
        }),
      )
      .optional(),
    workouts: z
      .array(
        z
          .object({
            id: z.string().optional(),
            name: z.string(),
            start: z.string(),
            end: z.string(),
            duration: z.number().optional(),
            distance: z.object({ qty: z.number(), units: z.string() }).optional(),
          })
          .passthrough(),
      )
      .optional(),
  }),
});

const importSchema = z.object({
  userEmail: z.string().email(),
  files: z.array(fileSchema).min(1),
});

router.post('/import', async (req, res) => {
  const syncKey = process.env.SYNC_API_KEY;
  if (!syncKey || req.headers['x-sync-key'] !== syncKey) {
    return res.status(401).json({ error: 'Invalid or missing sync key' });
  }

  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { userEmail, files } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) return res.status(404).json({ error: 'No account with that email' });

  const result = await applyHealthFiles(user.id, files as HealthAutoExportFile[]);
  res.json(result);
});

/**
 * A "sync now" press should tell the truth about what it did. A normal sync is
 * a handful of API calls, so it is awaited and answers with what it imported —
 * previously these routes replied `{started:true}` before doing any work, so
 * the dashboard refetched and re-rendered the *old* data and the press looked
 * like a no-op. A force backfill walks the whole history and is far too long to
 * hold a request open for, so that one stays fire-and-forget.
 */
const SYNC_TIMED_OUT = Symbol('sync-timed-out');

/** Longest a manual sync is held open for before the page gets an answer anyway. */
const AWAIT_SYNC_MS = 60_000;

async function respondToSyncNow(
  res: Response,
  label: string,
  userId: string,
  force: boolean,
  run: (opts: { force?: boolean }) => Promise<Record<string, number>>,
) {
  function logWhenSettled(pending: Promise<Record<string, number>>, what: string) {
    pending
      .then((result) => console.log(`[${label}] ${what} for user ${userId}:`, result))
      .catch((err) => console.error(`[${label}] ${what} for user ${userId} failed:`, err));
  }

  if (force) {
    res.json({ started: true, completed: false });
    logWhenSettled(run({ force: true }), 'manual backfill');
    return;
  }

  const pending = run({ force: false });
  // Whichever branch below wins, this promise must not reject unhandled.
  pending.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof SYNC_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(SYNC_TIMED_OUT), AWAIT_SYNC_MS);
  });

  try {
    const outcome = await Promise.race([pending, timeout]);
    if (outcome === SYNC_TIMED_OUT) {
      // Unusually slow (a big first sync, a throttled provider). Hand the page
      // back rather than holding the request until a proxy cuts it, and let the
      // run finish on its own — the next refresh picks up what it imported.
      res.json({ started: true, completed: false });
      logWhenSettled(pending, 'manual sync (still running when the request returned)');
      return;
    }
    console.log(`[${label}] manual sync for user ${userId}:`, outcome);
    res.json({ started: true, completed: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${label}] manual sync for user ${userId} failed:`, err);
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
}

function callbackUrl(req: { protocol: string; get: (name: string) => string | undefined }) {
  return `${req.protocol}://${req.get('host')}/api/health/dropbox/callback`;
}

router.get('/dropbox/status', requireAuth, async (req: AuthedRequest, res) => {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId: req.userId } });
  res.json({
    configured: dropboxConfigured(),
    connected: Boolean(config),
    lastSyncedAt: config?.lastSyncedAt ?? null,
    lastAttemptedAt: config?.lastAttemptedAt ?? null,
    lastSyncError: config?.lastSyncError ?? null,
  });
});

router.get('/dropbox/connect', async (req, res) => {
  if (!dropboxConfigured()) {
    return res.status(500).send('Dropbox app credentials are not configured on this server.');
  }
  const token = req.query.token;
  if (typeof token !== 'string') return res.status(401).send('Missing token');

  let userId: string;
  try {
    userId = (jwt.verify(token, JWT_SECRET!) as { userId: string }).userId;
  } catch {
    return res.status(401).send('Invalid or expired token');
  }

  const state = jwt.sign({ userId, purpose: 'dropbox-connect' }, JWT_SECRET!, { expiresIn: '10m' });
  const redirectUri = callbackUrl(req);
  const authorizeUrl = buildAuthorizeUrl(redirectUri, state);
  console.log(`[dropbox] redirecting user ${userId} to Dropbox, redirect_uri=${redirectUri}`);
  res.redirect(authorizeUrl);
});

router.get('/dropbox/callback', async (req, res) => {
  const { code, state } = req.query;
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send('Missing code or state');
  }

  let userId: string;
  try {
    const payload = jwt.verify(state, JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== 'dropbox-connect') throw new Error('wrong purpose');
    userId = payload.userId;
  } catch {
    return res.status(401).send('Invalid or expired state');
  }

  try {
    const tokens = await exchangeCodeForTokens(code, callbackUrl(req));
    if (!tokens.refresh_token) {
      return res.status(500).send('Dropbox did not return a refresh token');
    }
    await prisma.healthSyncConfig.upsert({
      where: { userId },
      create: { userId, dropboxRefreshToken: tokens.refresh_token },
      update: { dropboxRefreshToken: tokens.refresh_token, lastSyncError: null },
    });
    console.log(`[dropbox] connected successfully for user ${userId}`);
    res.redirect('/?dropbox=connected');
  } catch (err) {
    console.error(`[dropbox] callback failed for user ${userId}:`, err);
    res.status(500).send(`Failed to connect Dropbox: ${err instanceof Error ? err.message : err}`);
  }
});

router.post('/dropbox/sync-now', requireAuth, async (req: AuthedRequest, res) => {
  const { runSyncForUser } = await import('../lib/healthSyncJob.js');
  const userId = req.userId!;
  await respondToSyncNow(res, 'health-sync', userId, req.query.force === 'true', (opts) =>
    runSyncForUser(userId, opts),
  );
});

router.get('/garmin/status', requireAuth, async (req: AuthedRequest, res) => {
  const config = await prisma.garminSyncConfig.findUnique({ where: { userId: req.userId } });
  res.json({
    connected: Boolean(config),
    lastSyncedAt: config?.lastSyncedAt ?? null,
    lastAttemptedAt: config?.lastAttemptedAt ?? null,
    lastSyncError: config?.lastSyncError ?? null,
  });
});

const garminConnectSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/garmin/connect', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = garminConnectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await connectGarminAccountAndSave(req.userId!, parsed.data.username, parsed.data.password);
    res.json(result.mfaRequired ? { mfaRequired: true, pendingId: result.pendingId } : { connected: true });
  } catch (err) {
    console.error(`[garmin] login failed for user ${req.userId}:`, err);
    res.status(400).json({ error: `Garmin login failed: ${friendlyGarminAuthError(err)}` });
  }
});

const garminMfaSchema = z.object({
  pendingId: z.string().min(1),
  code: z.string().min(1),
});

router.post('/garmin/verify-mfa', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = garminMfaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await completeGarminAccountConnect(req.userId!, parsed.data.pendingId, parsed.data.code);
    res.json({ connected: true });
  } catch (err) {
    console.error(`[garmin] MFA verification failed for user ${req.userId}:`, err);
    res.status(400).json({ error: friendlyGarminAuthError(err) });
  }
});

router.post('/garmin/disconnect', requireAuth, async (req: AuthedRequest, res) => {
  await prisma.garminSyncConfig.deleteMany({ where: { userId: req.userId } });
  res.json({ connected: false });
});

router.post('/garmin/sync-now', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  await respondToSyncNow(res, 'garmin-sync', userId, req.query.force === 'true', (opts) =>
    runGarminSyncForUser(userId, opts),
  );
});

const garminPushSegmentSchema = z.object({
  durationSec: z.number().positive(),
  intensityFraction: z.number().optional(),
  intensityLow: z.number().optional(),
  intensityHigh: z.number().optional(),
  role: z.enum(['warmup', 'cooldown']).optional(),
  targetMetric: z.enum(['power', 'pace', 'hr']).optional(),
});

const garminPushWorkoutSchema = z.object({
  name: z.string().min(1),
  discipline: z.enum(['BIKE', 'RUN']),
  segments: z.array(garminPushSegmentSchema).min(1),
});

router.post('/garmin/push-workout', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = garminPushWorkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await pushWorkoutToGarmin(
      req.userId!,
      parsed.data.name,
      parsed.data.discipline,
      parsed.data.segments,
    );
    res.json({ pushed: true, workoutId: result.workoutId });
  } catch (err) {
    console.error(`[garmin] push workout failed for user ${req.userId}:`, err);
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to send workout to Garmin',
    });
  }
});

function stravaCallbackUrl(req: { protocol: string; get: (name: string) => string | undefined }) {
  return `${req.protocol}://${req.get('host')}/api/health/strava/callback`;
}

router.get('/strava/status', requireAuth, async (req: AuthedRequest, res) => {
  const config = await prisma.stravaSyncConfig.findUnique({ where: { userId: req.userId } });
  res.json({
    configured: stravaConfigured(),
    connected: Boolean(config),
    lastSyncedAt: config?.lastSyncedAt ?? null,
    lastAttemptedAt: config?.lastAttemptedAt ?? null,
    lastSyncError: config?.lastSyncError ?? null,
  });
});

router.get('/strava/connect', async (req, res) => {
  if (!stravaConfigured()) {
    return res.status(500).send('Strava app credentials are not configured on this server.');
  }
  const token = req.query.token;
  if (typeof token !== 'string') return res.status(401).send('Missing token');

  let userId: string;
  try {
    userId = (jwt.verify(token, JWT_SECRET!) as { userId: string }).userId;
  } catch {
    return res.status(401).send('Invalid or expired token');
  }

  const state = jwt.sign({ userId, purpose: 'strava-connect' }, JWT_SECRET!, { expiresIn: '10m' });
  const redirectUri = stravaCallbackUrl(req);
  const authorizeUrl = buildStravaAuthorizeUrl(redirectUri, state);
  console.log(`[strava] redirecting user ${userId} to Strava, redirect_uri=${redirectUri}`);
  res.redirect(authorizeUrl);
});

router.get('/strava/callback', async (req, res) => {
  const { code, state } = req.query;
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send('Missing code or state');
  }

  let userId: string;
  try {
    const payload = jwt.verify(state, JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== 'strava-connect') throw new Error('wrong purpose');
    userId = payload.userId;
  } catch {
    return res.status(401).send('Invalid or expired state');
  }

  try {
    await connectStravaAccount(userId, code);
    console.log(`[strava] connected successfully for user ${userId}`);
    res.redirect('/?strava=connected');
  } catch (err) {
    console.error(`[strava] callback failed for user ${userId}:`, err);
    res.status(500).send(`Failed to connect Strava: ${err instanceof Error ? err.message : err}`);
  }
});

router.post('/strava/disconnect', requireAuth, async (req: AuthedRequest, res) => {
  await prisma.stravaSyncConfig.deleteMany({ where: { userId: req.userId } });
  res.json({ connected: false });
});

router.post('/strava/sync-now', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  await respondToSyncNow(res, 'strava-sync', userId, req.query.force === 'true', (opts) =>
    runStravaSyncForUser(userId, opts),
  );
});

export default router;
