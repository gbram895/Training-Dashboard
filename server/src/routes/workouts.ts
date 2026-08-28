import { Router } from 'express';
import { z } from 'zod';
import { WorkoutType } from '@prisma/client';
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
  type: z.enum(['RUN', 'RIDE', 'STRENGTH', 'SWIM', 'WALK', 'BADMINTON', 'OTHER']),
  date: z.string().datetime().or(z.string().min(1)),
  durationMin: z.number().int().positive(),
  distanceKm: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  exercises: z.array(exerciseSchema).optional(),
});

router.get('/', async (req: AuthedRequest, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined;

  const workouts = await prisma.workout.findMany({
    where: { userId: req.userId },
    orderBy: { date: 'desc' },
    take: limit,
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

const DISCIPLINES: WorkoutType[] = ['RUN', 'RIDE', 'SWIM'];

function weekStartKey(date: Date): string {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  const day = weekStart.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diffToMonday);
  return weekStart.toISOString().slice(0, 10);
}

function emptyDisciplineTotals() {
  return { RUN: { distanceKm: 0, durationMin: 0 }, RIDE: { distanceKm: 0, durationMin: 0 }, SWIM: { distanceKm: 0, durationMin: 0 } };
}

function yearStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

router.get('/discipline-stats', async (req: AuthedRequest, res) => {
  const weeksBack = 8;
  const weeklySince = new Date();
  weeklySince.setDate(weeklySince.getDate() - weeksBack * 7);
  const since = yearStart();

  const [yearlyWorkouts, recentWorkouts, badmintonWorkouts] = await Promise.all([
    prisma.workout.findMany({ where: { userId: req.userId, type: { in: DISCIPLINES }, date: { gte: since } } }),
    prisma.workout.findMany({
      where: { userId: req.userId, type: { in: DISCIPLINES }, date: { gte: weeklySince } },
      orderBy: { date: 'asc' },
    }),
    prisma.workout.findMany({ where: { userId: req.userId, type: 'BADMINTON', date: { gte: since } } }),
  ]);

  const yearly = emptyDisciplineTotals();
  for (const w of yearlyWorkouts) {
    yearly[w.type as 'RUN' | 'RIDE' | 'SWIM'].distanceKm += w.distanceKm ?? 0;
    yearly[w.type as 'RUN' | 'RIDE' | 'SWIM'].durationMin += w.durationMin;
  }

  const badmintonHours = badmintonWorkouts.reduce((sum, w) => sum + w.durationMin, 0) / 60;

  const weeklyMap: Record<string, ReturnType<typeof emptyDisciplineTotals>> = {};
  for (const w of recentWorkouts) {
    const key = weekStartKey(w.date);
    if (!weeklyMap[key]) weeklyMap[key] = emptyDisciplineTotals();
    weeklyMap[key][w.type as 'RUN' | 'RIDE' | 'SWIM'].distanceKm += w.distanceKm ?? 0;
    weeklyMap[key][w.type as 'RUN' | 'RIDE' | 'SWIM'].durationMin += w.durationMin;
  }

  const weekly = Object.entries(weeklyMap)
    .map(([weekStart, disciplines]) => ({ weekStart, ...disciplines }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  res.json({ yearly, badmintonHours, weekly });
});

router.get('/hr-zones-weekly', async (req: AuthedRequest, res) => {
  const weeksBack = 8;
  const since = new Date();
  since.setDate(since.getDate() - weeksBack * 7);

  const workouts = await prisma.workout.findMany({
    where: { userId: req.userId, date: { gte: since }, hrZone1Min: { not: null } },
    orderBy: { date: 'asc' },
  });

  const weeklyMap: Record<string, { z1: number; z2: number; z3: number; z4: number; z5: number }> = {};
  for (const w of workouts) {
    const key = weekStartKey(w.date);
    if (!weeklyMap[key]) weeklyMap[key] = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    weeklyMap[key].z1 += w.hrZone1Min ?? 0;
    weeklyMap[key].z2 += w.hrZone2Min ?? 0;
    weeklyMap[key].z3 += w.hrZone3Min ?? 0;
    weeklyMap[key].z4 += w.hrZone4Min ?? 0;
    weeklyMap[key].z5 += w.hrZone5Min ?? 0;
  }

  const weekly = Object.entries(weeklyMap)
    .map(([weekStart, zones]) => ({ weekStart, ...zones }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  res.json(weekly);
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
