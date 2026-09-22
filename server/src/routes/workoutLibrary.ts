import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { fetchWorkoutLibrary } from '../lib/workoutLibrary.js';
import { buildFitWorkoutFile } from '../lib/garminFitWorkout.js';
import { loadAthleteSpeedThresholds, type GarminPushSegment } from '../lib/garminWorkoutPush.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthedRequest, res) => {
  try {
    const workouts = await fetchWorkoutLibrary(req.userId!);

    if (req.query.format === 'fit') {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const workout = workouts.find((w) => w.path === path);
      if (!workout || workout.discipline !== 'BIKE' || !workout.segments?.length) {
        return res.status(404).json({ error: 'No bike workout found at that path' });
      }
      const thresholds = await loadAthleteSpeedThresholds(req.userId!);
      const bytes = buildFitWorkoutFile(workout.name, 'BIKE', workout.segments as GarminPushSegment[], thresholds);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="workout.fit"');
      return res.send(Buffer.from(bytes));
    }

    res.json(workouts);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load workout library' });
  }
});

router.get('/selected', async (req: AuthedRequest, res) => {
  const selected = await prisma.selectedWorkout.findUnique({ where: { userId: req.userId } });
  res.json(selected);
});

// Keeps every field the parser produces: a selected workout is handed straight
// back to the profile chart, the segment cards and the Garmin push, and each of
// those reads something the narrower shape used to drop on the floor.
const segmentSchema = z.object({
  durationSec: z.number().positive(),
  intensityFraction: z.number().optional(),
  intensityLow: z.number().optional(),
  intensityHigh: z.number().optional(),
  role: z.enum(['warmup', 'cooldown']).optional(),
  targetMetric: z.enum(['power', 'pace', 'hr']).optional(),
});

const selectSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  discipline: z.enum(['BIKE', 'RUN']),
  durationMin: z.number().int().positive().optional(),
  intensity: z.number().int().min(1).max(5).optional(),
  trainingStress: z.number().int().min(1).max(5).optional(),
  profile: z.string().optional(),
  segments: z.array(segmentSchema).optional(),
});

router.post('/select', async (req: AuthedRequest, res) => {
  const parsed = selectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { path, segments, ...fields } = parsed.data;
  const userId = req.userId!;
  const segmentsValue = segments ?? Prisma.DbNull;

  const selected = await prisma.selectedWorkout.upsert({
    where: { userId },
    create: { userId, sourcePath: path, segments: segmentsValue, ...fields },
    update: { sourcePath: path, segments: segmentsValue, ...fields, selectedAt: new Date() },
  });
  res.json(selected);
});

router.delete('/selected', async (req: AuthedRequest, res) => {
  await prisma.selectedWorkout.deleteMany({ where: { userId: req.userId } });
  res.json({ cleared: true });
});

export default router;
