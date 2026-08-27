import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import type { HealthAutoExportFile } from '../lib/appleHealth.js';
import { applyHealthFiles } from '../lib/healthImport.js';
import { buildAuthorizeUrl, dropboxConfigured, exchangeCodeForTokens } from '../lib/dropbox.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

const router = Router();

router.get('/summary', requireAuth, async (req: AuthedRequest, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);

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
        z.object({
          name: z.string(),
          start: z.string(),
          end: z.string(),
          duration: z.number().optional(),
          distance: z.object({ qty: z.number(), units: z.string() }).optional(),
        }),
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

function callbackUrl(req: { protocol: string; get: (name: string) => string | undefined }) {
  return `${req.protocol}://${req.get('host')}/api/health/dropbox/callback`;
}

router.get('/dropbox/status', requireAuth, async (req: AuthedRequest, res) => {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId: req.userId } });
  res.json({
    configured: dropboxConfigured(),
    connected: Boolean(config),
    lastSyncedAt: config?.lastSyncedAt ?? null,
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
  try {
    const result = await runSyncForUser(req.userId!);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

export default router;
