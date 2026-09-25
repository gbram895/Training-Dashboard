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
  setDayDiscipline,
  swapPlannedDays,
} from '../lib/trainingPlan.js';
import { buildWeeklyReview } from '../lib/weeklyReview.js';
import { computeFitnessSeries } from '../lib/fitness.js';
import {
  findGoalConflicts,
  forecastGoals,
  measureTssPerHour,
  pickAnchor,
  projectSeason,
  type PeriodizationContext,
} from '../lib/periodization.js';
import { measureThresholdPotentials } from '../lib/thresholdPotential.js';
import { isBikeKind, isRunKind } from '../lib/goalSpecificity.js';
import type { GoalKind } from '@prisma/client';
import { asString } from '../lib/params.js';
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

const dayDisciplineSchema = z.object({
  date: z.string().min(1),
  discipline: z.enum(['BIKE', 'RUN']).nullable(),
});

// "Switch to run" / "Switch to bike" on the Suggested Training card, or the
// weekly check-in — forces a day's discipline; the algorithm still picks
// which specific workout. discipline: null clears the override.
router.put('/day-discipline', async (req: AuthedRequest, res) => {
  const parsed = dayDisciplineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const date = utcMidnight(new Date(parsed.data.date));
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });

  const today = utcMidnight(new Date());
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + ROLLING_WINDOW_DAYS - 1);
  if (date < today || date > maxDate) {
    return res.status(400).json({ error: 'Date must be within the plan window' });
  }

  const updated = await setDayDiscipline(req.userId!, date, parsed.data.discipline);
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

// --- Training goals --------------------------------------------------------
// The events the athlete is building toward. There can be several — the normal
// shape of a season — and they are periodised together rather than one at a
// time: the ramp aims at the season's anchor goal while any of them can claim
// a day for its taper, its race or its recovery afterwards. With none set, plan
// generation stays exactly as it was. See lib/periodization.ts.

async function targetsFor(userId: string) {
  return prisma.trainingTarget.findMany({ where: { userId }, orderBy: { date: 'asc' } });
}

async function periodizationContextFor(
  userId: string,
): Promise<{ ctx: PeriodizationContext; includeRunning: boolean } | null> {
  const [targets, config] = await Promise.all([
    targetsFor(userId),
    prisma.trainingPlanConfig.findUnique({ where: { userId } }),
  ]);
  if (!targets.length) return null;

  const series = await computeFitnessSeries(userId);
  const last = series.length ? series[series.length - 1] : null;
  return {
    ctx: {
      targets,
      currentCtl: last?.ctl ?? 0,
      currentAtl: last?.atl ?? 0,
      tssPerHour: await measureTssPerHour(userId),
      weeklyHours: config?.weeklyHours ?? 0,
    },
    includeRunning: config?.includeRunning ?? false,
  };
}

router.get('/targets', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const [targets, config] = await Promise.all([
    targetsFor(userId),
    prisma.trainingPlanConfig.findUnique({ where: { userId }, select: { includeRunning: true } }),
  ]);
  const today = utcMidnight(new Date());
  res.json({
    targets,
    anchorId: pickAnchor(targets, today)?.id ?? null,
    conflicts: findGoalConflicts(targets, today, config),
  });
});

// A week-by-week view of the whole season. The rolling plan window is a
// fortnight, so without this there is nothing that shows the athlete their
// goals nine months out have actually been taken into account.
router.get('/season', async (req: AuthedRequest, res) => {
  const loaded = await periodizationContextFor(req.userId!);
  if (!loaded) return res.json({ weeks: [], conflicts: [] });

  const { ctx, includeRunning } = loaded;
  const today = utcMidnight(new Date());
  res.json({
    weeks: projectSeason(ctx, today),
    conflicts: findGoalConflicts(ctx.targets, today, { includeRunning }),
    currentCtl: Math.round(ctx.currentCtl * 10) / 10,
  });
});

// The straight answer to "how fit will I be for each of my goals": the season
// projection sampled on each goal's own date, giving the fitness (CTL) and
// freshness (Form) the athlete is on course to bring to it. Shares the same
// projection as /season, so the numbers here and the season chart agree.
router.get('/forecast', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const loaded = await periodizationContextFor(userId);
  // Measured from workout summaries either way, so the basis lines can still
  // explain themselves when there are no goals set yet.
  const potentials = await measureThresholdPotentials(userId);
  if (!loaded) {
    return res.json({
      currentCtl: 0,
      goals: [],
      currentFtpWatts: potentials.ftp?.current ?? null,
      currentThresholdPaceSecPerKm: potentials.pace?.current ?? null,
      ftpBasis: potentials.ftpBasis,
      paceBasis: potentials.paceBasis,
    });
  }
  res.json(forecastGoals(loaded.ctx, utcMidnight(new Date()), potentials));
});

const goalKind = z.enum([
  'GENERAL',
  'LONG_RIDE',
  'HILLY_RIDE',
  'RACE_RIDE',
  'TIME_TRIAL',
  'GRAVEL_MTB',
  'RUN_SHORT',
  'RUN_LONG',
  'TRAIL_ULTRA',
  'MULTISPORT',
]);

const targetSchema = z.object({
  name: z.string().min(1).max(80),
  date: z.string(),
  priority: z.enum(['A', 'B', 'C']).optional(),
  // What kind of event it is, which is what makes the plan train for it rather
  // than just around it. GENERAL is "no particular event" — see
  // lib/goalSpecificity.ts.
  kind: goalKind.optional(),
  // For a MULTISPORT goal only: what each leg of it is. Validated against the
  // discipline they stand for, so a "run leg" can't be a time trial.
  bikeKind: goalKind.nullish(),
  runKind: goalKind.nullish(),
  peakCtl: z.number().positive().max(200).nullish(),
  // Above about 7 CTL points a week is where people get hurt rather than fit,
  // so the ceiling is enforced here rather than left to the UI.
  rampPerWeek: z.number().min(1).max(7).optional(),
  recoveryEveryNWeeks: z.number().int().min(2).max(8).optional(),
  taperDays: z.number().int().min(0).max(28).optional(),
});

/**
 * `currentKind` is what the goal is already stored as, so a partial update that
 * doesn't mention `kind` still resolves its legs against the right one.
 */
function parseTargetBody(body: unknown, partial: boolean, currentKind: GoalKind = 'GENERAL') {
  const schema = partial ? targetSchema.partial() : targetSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: parsed.error.flatten() as unknown } as const;

  const { date: rawDate, peakCtl, bikeKind, runKind, ...rest } = parsed.data;
  let date: Date | undefined;
  if (rawDate !== undefined) {
    date = utcMidnight(new Date(rawDate));
    if (Number.isNaN(date.getTime())) return { error: 'Invalid date' } as const;
    if (date < utcMidnight(new Date())) return { error: 'That date has already passed' } as const;
  }

  // Legs belong to a multisport goal and nothing else. A goal that stops being
  // multisport has them cleared rather than left behind to confuse whatever
  // reads the row next; one that is multisport must have legs in the right
  // discipline, so a "run leg" can never be a time trial.
  const effectiveKind = rest.kind ?? currentKind;
  // A key left out is left alone by Prisma, which is what a partial update
  // should do; an explicit null clears that leg back to the default.
  let legs: Partial<{ bikeKind: GoalKind | null; runKind: GoalKind | null }> | null = null;
  if (effectiveKind === 'MULTISPORT') {
    if (bikeKind != null && !isBikeKind(bikeKind)) return { error: 'The bike leg has to be a bike event' } as const;
    if (runKind != null && !isRunKind(runKind)) return { error: 'The run leg has to be a run event' } as const;
    legs = {
      ...(bikeKind !== undefined ? { bikeKind: bikeKind ?? null } : {}),
      ...(runKind !== undefined ? { runKind: runKind ?? null } : {}),
    };
  } else if (rest.kind !== undefined || !partial) {
    legs = { bikeKind: null, runKind: null };
  }

  return {
    fields: {
      ...rest,
      ...(date ? { date } : {}),
      ...(peakCtl !== undefined ? { peakCtl: peakCtl ?? null } : {}),
      ...(legs ?? {}),
    },
  } as const;
}

router.post('/targets', async (req: AuthedRequest, res) => {
  const parsed = parseTargetBody(req.body, false);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  const userId = req.userId!;

  // startedOn anchors the build/recovery cycle. A new goal joins the season
  // already in progress rather than restarting week 1 — see seasonStart.
  const existing = await targetsFor(userId);
  const startedOn = existing.length
    ? existing.reduce((earliest, t) => (t.startedOn < earliest ? t.startedOn : earliest), existing[0].startedOn)
    : utcMidnight(new Date());

  const target = await prisma.trainingTarget.create({
    data: { userId, startedOn, ...(parsed.fields as { name: string; date: Date }) },
  });

  await generatePlanWindow(userId);
  res.status(201).json(target);
});

router.put('/targets/:id', async (req: AuthedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.trainingTarget.findFirst({ where: { id, userId: req.userId } });
  if (!existing) return res.status(404).json({ error: 'Goal not found' });

  const parsed = parseTargetBody(req.body, true, existing.kind);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const target = await prisma.trainingTarget.update({ where: { id }, data: parsed.fields });
  await generatePlanWindow(req.userId!);
  res.json(target);
});

router.delete('/targets/:id', async (req: AuthedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.trainingTarget.findFirst({ where: { id, userId: req.userId } });
  if (!existing) return res.status(404).json({ error: 'Goal not found' });

  await prisma.trainingTarget.delete({ where: { id } });
  await generatePlanWindow(req.userId!);
  res.status(204).send();
});

// Kept for an app still running the single-target build from a cached bundle:
// reads back whichever goal is next rather than 404ing at it.
router.get('/target', async (req: AuthedRequest, res) => {
  const today = utcMidnight(new Date());
  const targets = await targetsFor(req.userId!);
  const ahead = targets.filter((t) => t.date >= today);
  res.json(ahead[0] ?? null);
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
