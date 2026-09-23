import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { ROLLING_WINDOW_DAYS } from '../lib/trainingPlan.js';

const router = Router();
router.use(requireAuth);

// A year plus a little slack. The month grid asks for the days either side of
// the month it is drawing, and the year view asks for a whole calendar year in
// one go — one request per year rather than twelve is deliberate, since this
// runs on a free instance that sleeps between uses.
const MAX_RANGE_DAYS = 400;

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses a YYYY-MM-DD (or any ISO timestamp) query param into that calendar day at UTC midnight. */
function parseDay(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface CalendarPlanned {
  isRestDay: boolean;
  restReason: string | null;
  name: string | null;
  discipline: 'BIKE' | 'RUN' | null;
  durationMin: number | null;
  intensity: number | null;
  trainingStress: number | null;
  category: string | null;
  focus: string | null;
  phase: string | null;
  manualOverride: boolean;
}

export interface CalendarWorkout {
  id: string;
  type: string;
  /** The name the source gave the activity, when it sent one. */
  title: string | null;
  date: string;
  durationMin: number;
  distanceKm: number | null;
  tss: number | null;
  rpe: number | null;
}

export interface CalendarDay {
  date: string;
  planned?: CalendarPlanned;
  done?: CalendarWorkout[];
  goals?: { id: string; name: string; priority: string; kind: string }[];
}

/**
 * Everything the calendar needs for a date range, in one request: what the plan
 * asked for each day, what was actually done, and which days carry a goal.
 *
 * Days with nothing on them are left out rather than sent as empty rows — over
 * a year that is most of them, and the client is drawing the grid from the
 * calendar itself anyway.
 */
router.get('/', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const from = parseDay(req.query.from);
  const to = parseDay(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  if (to < from) return res.status(400).json({ error: 'to must not be before from' });

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: `Range too long — ${MAX_RANGE_DAYS} days at most` });
  }

  // Workouts carry the real time of day they happened, not a UTC midnight, so
  // the upper bound has to be the start of the day after `to`.
  const dayAfterTo = new Date(to);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);

  const [plannedDays, workouts, targets, config] = await Promise.all([
    prisma.plannedDay.findMany({
      where: { userId, date: { gte: from, lte: to } },
      // Deliberately not `segments` — the full workout profile of every day in
      // a year is megabytes, and nothing on the calendar draws it.
      select: {
        date: true,
        isRestDay: true,
        restReason: true,
        name: true,
        discipline: true,
        durationMin: true,
        intensity: true,
        trainingStress: true,
        category: true,
        focus: true,
        phase: true,
        manualOverride: true,
      },
    }),
    prisma.workout.findMany({
      where: { userId, date: { gte: from, lt: dayAfterTo } },
      select: { id: true, type: true, title: true, date: true, durationMin: true, distanceKm: true, tss: true, rpe: true },
      orderBy: { date: 'asc' },
    }),
    prisma.trainingTarget.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { id: true, name: true, date: true, priority: true, kind: true },
      orderBy: { date: 'asc' },
    }),
    prisma.trainingPlanConfig.findUnique({
      where: { userId },
      select: {
        sundayHours: true,
        mondayHours: true,
        tuesdayHours: true,
        wednesdayHours: true,
        thursdayHours: true,
        fridayHours: true,
        saturdayHours: true,
      },
    }),
  ]);

  const days = new Map<string, CalendarDay>();
  const dayFor = (key: string): CalendarDay => {
    let day = days.get(key);
    if (!day) {
      day = { date: key };
      days.set(key, day);
    }
    return day;
  };

  for (const planned of plannedDays) {
    dayFor(dayKey(planned.date)).planned = {
      isRestDay: planned.isRestDay,
      restReason: planned.restReason,
      name: planned.name,
      discipline: planned.discipline,
      durationMin: planned.durationMin,
      intensity: planned.intensity,
      trainingStress: planned.trainingStress,
      category: planned.category,
      focus: planned.focus,
      phase: planned.phase,
      manualOverride: planned.manualOverride,
    };
  }

  for (const workout of workouts) {
    const day = dayFor(dayKey(workout.date));
    (day.done ??= []).push({
      id: workout.id,
      type: workout.type,
      title: workout.title,
      date: workout.date.toISOString(),
      durationMin: workout.durationMin,
      distanceKm: workout.distanceKm,
      tss: workout.tss,
      rpe: workout.rpe,
    });
  }

  for (const target of targets) {
    const day = dayFor(dayKey(target.date));
    (day.goals ??= []).push({
      id: target.id,
      name: target.name,
      priority: target.priority,
      kind: target.kind,
    });
  }

  const today = utcMidnight(new Date());
  // The last day the plan is actually generated for. Past this the calendar
  // shows the standing weekly rhythm rather than real sessions, and says so.
  const planHorizon = new Date(today);
  planHorizon.setUTCDate(planHorizon.getUTCDate() + ROLLING_WINDOW_DAYS - 1);

  res.json({
    from: dayKey(from),
    to: dayKey(to),
    today: dayKey(today),
    planHorizon: dayKey(planHorizon),
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    // Sunday-first, matching JS Date.getUTCDay(). Null when there is no plan
    // config at all, which is how the client knows not to promise future days.
    weeklyHours: config
      ? [
          config.sundayHours,
          config.mondayHours,
          config.tuesdayHours,
          config.wednesdayHours,
          config.thursdayHours,
          config.fridayHours,
          config.saturdayHours,
        ]
      : null,
  });
});

export default router;
