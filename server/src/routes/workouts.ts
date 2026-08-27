import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { asString } from '../lib/params.js';

const router = Router();
router.use(requireAuth);

const exerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().positive(),
  reps: z.number().int().positive(),
  weightKg: z.number().nonnegative().optional(),
});

const workoutSchema = z.object({
  type: z.enum(['RUN', 'RIDE', 'STRENGTH', 'SWIM', 'WALK', 'OTHER']),
  date: z.string().datetime().or(z.string().min(1)),
  durationMin: z.number().int().positive(),
  distanceKm: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  exercises: z.array(exerciseSchema).optional(),
});

router.get('/', async (req: AuthedRequest, res) => {
  const workouts = await prisma.workout.findMany({
    where: { userId: req.userId },
    orderBy: { date: 'desc' },
    include: { exercises: true },
  });
  res.json(workouts);
});

router.get('/stats', async (req: AuthedRequest, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 28);

  const workouts = await prisma.workout.findMany({
    where: { userId: req.userId, date: { gte: since } },
    orderBy: { date: 'asc' },
  });

  const weeklyBuckets: Record<string, { durationMin: number; distanceKm: number; count: number }> = {};
  for (const w of workouts) {
    const weekStart = new Date(w.date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeklyBuckets[key]) weeklyBuckets[key] = { durationMin: 0, distanceKm: 0, count: 0 };
    weeklyBuckets[key].durationMin += w.durationMin;
    weeklyBuckets[key].distanceKm += w.distanceKm ?? 0;
    weeklyBuckets[key].count += 1;
  }

  const totalWorkouts = workouts.length;
  const totalDurationMin = workouts.reduce((sum, w) => sum + w.durationMin, 0);
  const totalDistanceKm = workouts.reduce((sum, w) => sum + (w.distanceKm ?? 0), 0);

  res.json({
    totalWorkouts,
    totalDurationMin,
    totalDistanceKm,
    weeklyBuckets: Object.entries(weeklyBuckets)
      .map(([weekStart, data]) => ({ weekStart, ...data }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
  });
});

router.get('/:id', async (req: AuthedRequest, res) => {
  const id = asString(req.params.id);
  const workout = await prisma.workout.findFirst({
    where: { id, userId: req.userId },
    include: { exercises: true },
  });
  if (!workout) return res.status(404).json({ error: 'Workout not found' });
  res.json(workout);
});

router.post('/', async (req: AuthedRequest, res) => {
  const parsed = workoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { exercises, ...data } = parsed.data;

  const workout = await prisma.workout.create({
    data: {
      ...data,
      date: new Date(data.date),
      userId: req.userId!,
      exercises: exercises
        ? { create: exercises.map((e, order) => ({ ...e, order })) }
        : undefined,
    },
    include: { exercises: true },
  });
  res.status(201).json(workout);
});

router.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = workoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { exercises, ...data } = parsed.data;
  const id = asString(req.params.id);

  const existing = await prisma.workout.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ error: 'Workout not found' });

  await prisma.exerciseEntry.deleteMany({ where: { workoutId: id } });
  const workout = await prisma.workout.update({
    where: { id },
    data: {
      ...data,
      date: new Date(data.date),
      exercises: exercises
        ? { create: exercises.map((e, order) => ({ ...e, order })) }
        : undefined,
    },
    include: { exercises: true },
  });
  res.json(workout);
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.workout.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ error: 'Workout not found' });

  await prisma.workout.delete({ where: { id } });
  res.status(204).send();
});

export default router;
