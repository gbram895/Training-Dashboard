import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import {
  aggregateHealthExports,
  externalWorkoutId,
  mapWorkoutType,
  type HealthAutoExportFile,
} from '../lib/appleHealth.js';

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

  const daily = aggregateHealthExports(files as HealthAutoExportFile[]);
  for (const day of daily) {
    await prisma.dailyHealthSummary.upsert({
      where: { userId_date: { userId: user.id, date: new Date(day.date) } },
      create: { ...day, date: new Date(day.date), userId: user.id },
      update: { ...day, date: new Date(day.date) },
    });
  }

  let workoutsImported = 0;
  for (const file of files) {
    for (const workout of file.data.workouts ?? []) {
      const externalId = externalWorkoutId(workout);
      const durationMin = workout.duration
        ? Math.round(workout.duration / 60)
        : Math.round((new Date(workout.end).getTime() - new Date(workout.start).getTime()) / 60000);

      await prisma.workout.upsert({
        where: { externalId },
        create: {
          userId: user.id,
          type: mapWorkoutType(workout.name),
          date: new Date(workout.start),
          durationMin,
          distanceKm: workout.distance?.units === 'km' ? workout.distance.qty : undefined,
          source: 'apple_health',
          externalId,
        },
        update: {
          durationMin,
          distanceKm: workout.distance?.units === 'km' ? workout.distance.qty : undefined,
        },
      });
      workoutsImported += 1;
    }
  }

  res.json({ daysImported: daily.length, workoutsImported });
});

export default router;
