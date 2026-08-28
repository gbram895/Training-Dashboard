import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { fetchWorkoutLibrary } from '../lib/workoutLibrary.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthedRequest, res) => {
  try {
    const workouts = await fetchWorkoutLibrary(req.userId!);
    res.json(workouts);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load workout library' });
  }
});

router.get('/selected', async (req: AuthedRequest, res) => {
  const selected = await prisma.selectedWorkout.findUnique({ where: { userId: req.userId } });
  res.json(selected);
});

const selectSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  discipline: z.enum(['BIKE', 'RUN']),
  durationMin: z.number().int().positive().optional(),
  intensity: z.number().int().min(1).max(5).optional(),
  trainingStress: z.number().int().min(1).max(5).optional(),
  profile: z.string().optional(),
});

router.post('/select', async (req: AuthedRequest, res) => {
  const parsed = selectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { path, ...fields } = parsed.data;
  const userId = req.userId!;

  const selected = await prisma.selectedWorkout.upsert({
    where: { userId },
    create: { userId, sourcePath: path, ...fields },
    update: { sourcePath: path, ...fields, selectedAt: new Date() },
  });
  res.json(selected);
});

router.delete('/selected', async (req: AuthedRequest, res) => {
  await prisma.selectedWorkout.deleteMany({ where: { userId: req.userId } });
  res.json({ cleared: true });
});

export default router;
