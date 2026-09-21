import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import {
  generatePlanWindow,
  getPlannedDay,
  getPlannedWeek,
  revertManualOverrides,
  ROLLING_WINDOW_DAYS,
  setDayAvailability,
  swapPlannedDays,
} from '../lib/trainingPlan.js';
import { buildWeeklyReview } from '../lib/weeklyReview.js';
import { buildFitWorkoutFile } from '../lib/garminFitWorkout.js';
import { loadAthleteSpeedThresholds, type GarminPushSegment } from '../lib/garminWorkoutPush.js';

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
  const week = await getPlannedWeek(req.userId!);
  res.json(week);
});

const availabilitySchema = z.object({ hours: hoursSchema });

router.put('/today/availability', async (req: AuthedRequest, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = await setDayAvailability(req.userId!, new Date(), parsed.data.hours);
  if (!updated) return res.status(400).json({ error: 'Set up a training plan first' });
  res.json(updated);
});

const dayAvailabilitySchema = z.object({ date: z.string().min(1), hours: hoursSchema });

// The weekly availability check-in: set hours for any day already in the
// rolling window, not just today (e.g. "Tuesday I only have 30 minutes").
router.put('/day-availability', async (req: AuthedRequest, res) => {
  const parsed = dayAvailabilitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const date = utcMidnight(new Date(parsed.data.date));
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });

  const today = utcMidnight(new Date());
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + ROLLING_WINDOW_DAYS - 1);
  if (date < today || date > maxDate) {
    return res.status(400).json({ error: 'Date must be within the plan window' });
  }

  const updated = await setDayAvailability(req.userId!, date, parsed.data.hours);
  if (!updated) return res.status(400).json({ error: 'Set up a training plan first' });
  res.json(updated);
});

const swapSchema = z.object({ dateA: z.string().min(1), dateB: z.string().min(1) });

// Calendar drag-and-drop: swaps what's planned on two days. Both must be
// today or later — the week view never shows past days, and rewriting
// history that's already happened doesn't make sense.
router.put('/swap', async (req: AuthedRequest, res) => {
  const parsed = swapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const dateA = utcMidnight(new Date(parsed.data.dateA));
  const dateB = utcMidnight(new Date(parsed.data.dateB));
  if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) {
    return res.status(400).json({ error: 'Invalid date' });
  }
  const today = utcMidnight(new Date());
  if (dateA < today || dateB < today) {
    return res.status(400).json({ error: "Can't rearrange a day that's already passed" });
  }
  if (dateA.getTime() === dateB.getTime()) {
    return res.status(400).json({ error: 'Pick two different days' });
  }

  const result = await swapPlannedDays(req.userId!, dateA, dateB);
  if (!result) return res.status(404).json({ error: 'One of those days has no plan yet' });
  res.json(await getPlannedWeek(req.userId!));
});

// Undoes every manual rearrangement from today onward, handing the whole
// window back to the algorithm.
router.post('/revert', async (req: AuthedRequest, res) => {
  await revertManualOverrides(req.userId!);
  res.json(await getPlannedWeek(req.userId!));
});

router.get('/today', async (req: AuthedRequest, res) => {
  const today = await getPlannedDay(req.userId!, new Date());
  if (req.query.format !== 'fit') return res.json(today);

  if (!today || today.isRestDay || today.discipline !== 'BIKE' || !Array.isArray(today.segments) || !today.segments.length) {
    return res.status(404).json({ error: 'No bike workout planned for today' });
  }
  const thresholds = await loadAthleteSpeedThresholds(req.userId!);
  const bytes = buildFitWorkoutFile(
    today.name ?? 'Planned workout',
    'BIKE',
    today.segments as unknown as GarminPushSegment[],
    thresholds,
  );
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="today.fit"');
  res.send(Buffer.from(bytes));
});

// --- Training target -------------------------------------------------------
// The event or date the athlete is building toward. With no target set, plan
// generation stays exactly as it was; with one, each day's hours are scaled by
// a periodised ramp. See lib/periodization.ts.

router.get('/target', async (req: AuthedRequest, res) => {
  res.json(await prisma.trainingTarget.findUnique({ where: { userId: req.userId } }));
});

const targetSchema = z.object({
  name: z.string().min(1).max(80),
  date: z.string(),
  peakCtl: z.number().positive().max(200).nullish(),
  // Above about 7 CTL points a week is where people get hurt rather than fit,
  // so the ceiling is enforced here rather than left to the UI.
  rampPerWeek: z.number().min(1).max(7).optional(),
  recoveryEveryNWeeks: z.number().int().min(2).max(8).optional(),
  taperDays: z.number().int().min(0).max(28).optional(),
});

router.put('/target', async (req: AuthedRequest, res) => {
  const parsed = targetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const date = utcMidnight(new Date(parsed.data.date));
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
  if (date < utcMidnight(new Date())) return res.status(400).json({ error: 'Target date is in the past' });

  const { name, peakCtl, rampPerWeek, recoveryEveryNWeeks, taperDays } = parsed.data;
  const fields = {
    name,
    date,
    peakCtl: peakCtl ?? null,
    ...(rampPerWeek != null ? { rampPerWeek } : {}),
    ...(recoveryEveryNWeeks != null ? { recoveryEveryNWeeks } : {}),
    ...(taperDays != null ? { taperDays } : {}),
  };

  const target = await prisma.trainingTarget.upsert({
    where: { userId: req.userId },
    // startedOn anchors the build/recovery cycle, so it's set once when the
    // target is created and left alone on later edits — otherwise changing the
    // event name would restart the athlete's week count.
    create: { userId: req.userId!, startedOn: utcMidnight(new Date()), ...fields },
    update: fields,
  });

  await generatePlanWindow(req.userId!);
  res.json(target);
});

router.delete('/target', async (req: AuthedRequest, res) => {
  await prisma.trainingTarget.deleteMany({ where: { userId: req.userId } });
  await generatePlanWindow(req.userId!);
  res.status(204).send();
});

// --- Weekly review ---------------------------------------------------------

router.get('/review', async (req: AuthedRequest, res) => {
  // Defaults to the last completed week — a week still in progress can't be
  // judged against its own plan.
  const raw = Number(req.query.weeksAgo ?? 1);
  const weeksAgo = Number.isFinite(raw) ? Math.min(52, Math.max(0, Math.trunc(raw))) : 1;
  res.json(await buildWeeklyReview(req.userId!, weeksAgo));
});

export default router;
