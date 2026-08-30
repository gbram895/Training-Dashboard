import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { ensurePlannedDay, generatePlanWindow } from '../lib/trainingPlan.js';

const router = Router();
router.use(requireAuth);

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.get('/config', async (req: AuthedRequest, res) => {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId: req.userId } });
  res.json(config);
});

const hoursSchema = z
  .number()
  .min(0)
  .max(12)
  .refine((v) => Math.round(v * 4) === v * 4, 'Must be in 15-minute increments');

const configSchema = z.object({
  weeklyHours: hoursSchema,
  mondayHours: hoursSchema,
  tuesdayHours: hoursSchema,
  wednesdayHours: hoursSchema,
  thursdayHours: hoursSchema,
  fridayHours: hoursSchema,
  saturdayHours: hoursSchema,
  sundayHours: hoursSchema,
  includeRunning: z.boolean(),
  runDays: z.array(z.number().int().min(0).max(6)),
});

router.post('/config', async (req: AuthedRequest, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;

  const config = await prisma.trainingPlanConfig.upsert({
    where: { userId },
    create: { userId, ...parsed.data },
    update: { ...parsed.data },
  });

  await generatePlanWindow(userId);
  res.status(201).json(config);
});

router.delete('/config', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  await prisma.trainingPlanConfig.deleteMany({ where: { userId } });
  await prisma.plannedDay.deleteMany({ where: { userId, date: { gte: utcMidnight(new Date()) } } });
  res.json({ cleared: true });
});

router.get('/week', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return res.json([]);

  const today = utcMidnight(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    days.push(await ensurePlannedDay(userId, date));
  }
  res.json(days.filter(Boolean));
});

router.get('/today', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return res.json(null);

  const today = await ensurePlannedDay(userId, new Date());
  res.json(today);
});

export default router;
