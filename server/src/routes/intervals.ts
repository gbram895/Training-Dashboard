import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { seal } from '../lib/secretBox.js';
import { fetchPlannedWorkouts, IntervalsError } from '../lib/intervals.js';
import { importIntervalsPlan } from '../lib/intervalsPlan.js';
import { generatePlanWindow } from '../lib/trainingPlan.js';

// Settings > Rest or Train: linking the Intervals.icu account Rest or Train
// sends its plan to, and choosing whether the Plan tab follows that plan or
// Gradient's own.

const router = Router();
router.use(requireAuth);

async function status(userId: string) {
  const [connection, config] = await Promise.all([
    prisma.intervalsConnection.findUnique({ where: { userId } }),
    prisma.trainingPlanConfig.findUnique({ where: { userId }, select: { planSource: true } }),
  ]);
  return {
    connected: Boolean(connection),
    athleteId: connection?.athleteId ?? null,
    planSource: config?.planSource ?? 'GRADIENT',
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastAttemptedAt: connection?.lastAttemptedAt ?? null,
    lastSyncError: connection?.lastSyncError ?? null,
    lastEventCount: connection?.lastEventCount ?? null,
  };
}

/** Points the plan at a source, creating the plan settings row if the athlete never made a plan. */
async function setPlanSource(userId: string, planSource: 'GRADIENT' | 'INTERVALS') {
  await prisma.trainingPlanConfig.upsert({
    where: { userId },
    create: { userId, weeklyHours: 0, planSource },
    update: { planSource },
  });
}

router.get('/connection', async (req: AuthedRequest, res) => {
  res.json(await status(req.userId!));
});

const connectSchema = z.object({
  apiKey: z.string().trim().min(10).max(200),
  athleteId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v.replace(/^i/i, '') : '0'))
    .pipe(z.string().regex(/^\d+$/, 'The athlete id is a number')),
});

router.post('/connection', async (req: AuthedRequest, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Paste your Intervals.icu API key' });
  const userId = req.userId!;
  const { apiKey, athleteId } = parsed.data;

  // Try the key before keeping it, so a typo is said now rather than as a
  // failed sync later.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekOut = new Date(today);
  weekOut.setUTCDate(weekOut.getUTCDate() + 6);
  try {
    await fetchPlannedWorkouts(apiKey, athleteId, today, weekOut);
  } catch (err) {
    if (err instanceof IntervalsError) return res.status(400).json({ error: err.message });
    throw err;
  }

  await prisma.intervalsConnection.upsert({
    where: { userId },
    create: { userId, athleteId, apiKeySealed: seal(apiKey) },
    update: { athleteId, apiKeySealed: seal(apiKey), lastSyncError: null },
  });
  await setPlanSource(userId, 'INTERVALS');
  await importIntervalsPlan(userId);
  res.json(await status(userId));
});

router.post('/sync', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  if (!(await importIntervalsPlan(userId))) return res.status(404).json({ error: 'Intervals.icu is not connected' });
  res.json(await status(userId));
});

const sourceSchema = z.object({ planSource: z.enum(['GRADIENT', 'INTERVALS']) });

router.put('/source', async (req: AuthedRequest, res) => {
  const parsed = sourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Unknown plan source' });
  const userId = req.userId!;
  if (parsed.data.planSource === 'INTERVALS' && !(await prisma.intervalsConnection.findUnique({ where: { userId } }))) {
    return res.status(400).json({ error: 'Connect Intervals.icu first' });
  }
  await setPlanSource(userId, parsed.data.planSource);
  await clearImportedDays(userId, parsed.data.planSource);
  await generatePlanWindow(userId);
  res.json(await status(userId));
});

/**
 * Handing the plan back to Gradient: imported days carry Rest or Train's
 * sessions, which Gradient's own rebuild would otherwise read as days the
 * athlete set by hand. Nothing to clear when switching the other way.
 */
async function clearImportedDays(userId: string, planSource: 'GRADIENT' | 'INTERVALS') {
  if (planSource !== 'GRADIENT') return;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.plannedDay.updateMany({
    where: { userId, date: { gte: today }, externalId: { not: null } },
    data: { externalId: null, readinessWarning: null, manualOverride: false },
  });
}

router.delete('/connection', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  await prisma.intervalsConnection.deleteMany({ where: { userId } });
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (config?.planSource === 'INTERVALS') {
    await setPlanSource(userId, 'GRADIENT');
    await clearImportedDays(userId, 'GRADIENT');
    await generatePlanWindow(userId);
  }
  res.json(await status(userId));
});

export default router;
