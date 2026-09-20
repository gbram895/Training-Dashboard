import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { fetchWorkoutLibrary, type ParsedWorkoutFile, type PlannedDiscipline } from './workoutLibrary.js';
import type { WorkoutCategory } from './workoutIntensity.js';
import { computeFitnessSeries } from './fitness.js';

const DAY_KEYS = [
  'sundayHours',
  'mondayHours',
  'tuesdayHours',
  'wednesdayHours',
  'thursdayHours',
  'fridayHours',
  'saturdayHours',
] as const;

type DayKey = (typeof DAY_KEYS)[number];

interface PlanConfigHours {
  sundayHours: number;
  mondayHours: number;
  tuesdayHours: number;
  wednesdayHours: number;
  thursdayHours: number;
  fridayHours: number;
  saturdayHours: number;
}

function dayKeyFor(date: Date): DayKey {
  return DAY_KEYS[date.getUTCDay()];
}

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Very fatigued -> ease off; very fresh -> can handle the hardest sessions.
// Deliberately conservative bands so the app defaults to sustainable training
// rather than chasing peak fitness.
function categoryFromTsb(tsb: number): WorkoutCategory {
  if (tsb < -5) return 'ENDURANCE';
  if (tsb < 10) return 'TEMPO';
  if (tsb < 25) return 'THRESHOLD';
  return 'VO2MAX';
}

const CATEGORY_ORDER: WorkoutCategory[] = ['ENDURANCE', 'TEMPO', 'THRESHOLD', 'VO2MAX'];

function downgrade(category: WorkoutCategory, steps: number): WorkoutCategory {
  const idx = Math.max(0, CATEGORY_ORDER.indexOf(category) - steps);
  return CATEGORY_ORDER[idx];
}

// A severe negative Form (TSB) means the athlete is carrying a lot more
// fatigue than fitness right now — the classic overreaching signature. Below
// this, the plan overrides the day's own hour target and forces recovery
// regardless of what's scheduled, the same safety valve TrainingPeaks-style
// adaptive plans use.
const FORCED_REST_TSB = -30;

interface ReadinessModifiers {
  hrvRatio: number | null; // most recent HRV vs its own 7-day rolling average
  sleepHours: number | null; // most recent night's sleep
}

// HRV/sleep can't be predicted for future days, so every day in a generated
// window uses the same, most-recently-known readiness snapshot. TSB, on the
// other hand, IS projected forward day by day (see runProjection below) since
// it accumulates purely from the plan's own scheduled training load.
async function getReadinessModifiers(userId: string): Promise<ReadinessModifiers> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 8);
  const days = await prisma.dailyHealthSummary.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { avgHrv: true, sleepHours: true },
  });

  const hrvValues = days.map((d) => d.avgHrv).filter((v): v is number => v != null);
  const lastHrv = hrvValues[hrvValues.length - 1] ?? null;
  const baselineHrv = hrvValues.length ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null;
  const hrvRatio = lastHrv != null && baselineHrv ? lastHrv / baselineHrv : null;

  const lastSleep = days.length ? (days[days.length - 1].sleepHours ?? null) : null;

  return { hrvRatio, sleepHours: lastSleep };
}

function decideCategory(tsb: number | null, readiness: ReadinessModifiers): WorkoutCategory {
  let category = tsb != null ? categoryFromTsb(tsb) : 'TEMPO';

  let downgradeSteps = 0;
  if (readiness.hrvRatio != null && readiness.hrvRatio < 0.8) downgradeSteps += 1;
  if (readiness.sleepHours != null && readiness.sleepHours < 6) downgradeSteps += 1;

  if (downgradeSteps > 0) category = downgrade(category, downgradeSteps);
  return category;
}

// Rough numeric TSS per 1-5 stress bucket (see workoutIntensity.ts's own
// stressBucket thresholds — this just inverts them to a representative
// midpoint), used only to project CTL/ATL forward for days that haven't
// happened yet. The real, precise TSS from actual samples takes over once a
// workout is logged (see trainingLoad.ts) — this is just a planning estimate.
function estimatedTssForBucket(bucket: number | null | undefined): number {
  switch (bucket) {
    case 1:
      return 25;
    case 2:
      return 55;
    case 3:
      return 85;
    case 4:
      return 120;
    case 5:
      return 160;
    default:
      return 50;
  }
}

function pickWorkout(
  library: ParsedWorkoutFile[],
  discipline: PlannedDiscipline,
  targetMinutes: number,
  category: WorkoutCategory,
  avoidPaths: string[],
): ParsedWorkoutFile | null {
  const byDiscipline = library.filter((w) => w.discipline === discipline);
  if (byDiscipline.length === 0) return null;

  // Never hand back something wildly longer than what was actually scheduled
  // — a 3h ride on a day set for 1h is worse than no ride at all. A workout
  // with no parsed duration can't be checked, so it's let through but ranked
  // last (see distanceFrom below), rather than assumed to fit.
  const maxAllowedMinutes = Math.max(targetMinutes * 1.5, targetMinutes + 20);
  const withinTolerance = byDiscipline.filter((w) => w.durationMin == null || w.durationMin <= maxAllowedMinutes);
  if (withinTolerance.length === 0) return null;

  const distanceFrom = (w: ParsedWorkoutFile) => (w.durationMin == null ? Infinity : Math.abs(w.durationMin - targetMinutes));
  const closestIn = (pool: ParsedWorkoutFile[]) =>
    pool.reduce((best, w) => (distanceFrom(w) < distanceFrom(best) ? w : best), pool[0]);

  // Prefer a workout not used in the last couple of days, so a library with
  // several options in the same category doesn't collapse to one repeat —
  // but never refuse to plan a day just to avoid a repeat.
  const pickFrom = (pool: ParsedWorkoutFile[]) => {
    if (pool.length === 0) return null;
    const notRecent = pool.filter((w) => !avoidPaths.includes(w.path));
    return closestIn(notRecent.length > 0 ? notRecent : pool);
  };

  const inCategory = withinTolerance.filter((w) => (w.category ?? undefined) === category);
  if (inCategory.length > 0) return pickFrom(inCategory);

  // Fall back to the nearest category tier (both directions) before giving up
  // on the category entirely — an easier or harder session beats no session.
  const idx = CATEGORY_ORDER.indexOf(category);
  for (let radius = 1; radius < CATEGORY_ORDER.length; radius++) {
    const candidates = [CATEGORY_ORDER[idx - radius], CATEGORY_ORDER[idx + radius]]
      .filter((c): c is WorkoutCategory => c != null)
      .flatMap((c) => withinTolerance.filter((w) => w.category === c));
    if (candidates.length > 0) return pickFrom(candidates);
  }

  return pickFrom(withinTolerance);
}

interface GeneratedDay {
  date: Date;
  isRestDay: boolean;
  restReason?: string;
  workout?: ParsedWorkoutFile;
  category?: WorkoutCategory;
}

const CTL_DECAY = 1 - Math.exp(-1 / 42);
const ATL_DECAY = 1 - Math.exp(-1 / 7);
const RECENT_PICKS_MEMORY = 2;

/** Picks a rest day or a specific workout for one day, given its target hours and projected Form. */
function decideDay(
  date: Date,
  targetHours: number,
  tsb: number,
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[] },
  library: ParsedWorkoutFile[],
  readiness: ReadinessModifiers,
  avoidPaths: string[],
): GeneratedDay {
  if (!targetHours || targetHours <= 0) {
    return { date, isRestDay: true, restReason: 'No training hours scheduled today' };
  }
  if (tsb < FORCED_REST_TSB) {
    return {
      date,
      isRestDay: true,
      restReason: 'Fatigue is running high (low Form) — recovery takes priority today',
    };
  }

  const category = decideCategory(tsb, readiness);
  const discipline: PlannedDiscipline =
    config.includeRunning && config.runDays.includes(date.getUTCDay()) ? 'RUN' : 'BIKE';
  const targetMinutes = Math.round(targetHours * 60);
  const workout = pickWorkout(library, discipline, targetMinutes, category, avoidPaths);

  return workout
    ? { date, isRestDay: false, workout, category }
    : {
        date,
        isRestDay: true,
        restReason: `No ${discipline === 'RUN' ? 'run' : 'ride'} in your library short enough for ${targetHours}h — add a shorter one, or this stays a rest day`,
      };
}

/**
 * Generates each day in order, carrying a running CTL/ATL projection forward
 * from the athlete's real, current fitness — each day's own (estimated) TSS
 * feeds into the next day's projected Form, the same way the actual PMC will
 * once these are real, logged workouts. This is what makes the week vary
 * (a hard day naturally lowers Form for the next), instead of every future
 * day reusing today's exact TSB — which is what always produced the same
 * pick before.
 *
 * `todayOverrideHours`, when set, replaces the first date's (today's) config
 * hours — see setTodayAvailability, which is the only source of this value.
 */
async function runProjection(
  userId: string,
  dates: Date[],
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[] },
  library: ParsedWorkoutFile[],
  todayOverrideHours?: number | null,
): Promise<GeneratedDay[]> {
  const fitness = await computeFitnessSeries(userId);
  let ctl = fitness.length ? fitness[fitness.length - 1].ctl : 0;
  let atl = fitness.length ? fitness[fitness.length - 1].atl : 0;
  const readiness = await getReadinessModifiers(userId);

  const recentPicks: string[] = [];
  const results: GeneratedDay[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const tsb = ctl - atl;
    const targetHours = i === 0 && todayOverrideHours != null ? todayOverrideHours : config[dayKeyFor(date)];

    const generated = decideDay(date, targetHours, tsb, config, library, readiness, recentPicks);
    results.push(generated);

    const dayTss = generated.isRestDay ? 0 : estimatedTssForBucket(generated.workout?.trainingStress);
    ctl = ctl + (dayTss - ctl) * CTL_DECAY;
    atl = atl + (dayTss - atl) * ATL_DECAY;

    if (!generated.isRestDay && generated.workout) {
      recentPicks.push(generated.workout.path);
      if (recentPicks.length > RECENT_PICKS_MEMORY) recentPicks.shift();
    }
  }

  return results;
}

/**
 * `availableHoursOverride`: pass a number to record it on the row (the
 * one-off availability slider), or omit it entirely to leave the column
 * untouched — the normal rolling-window regeneration path never sets it, so
 * an existing override on today's row survives a regeneration it wasn't part
 * of (e.g. the user editing next week's hours later the same day).
 */
async function upsertPlannedDay(userId: string, generated: GeneratedDay, availableHoursOverride?: number) {
  const base = generated.isRestDay
    ? {
        isRestDay: true,
        restReason: generated.restReason,
        sourcePath: null,
        name: null,
        discipline: null,
        durationMin: null,
        intensity: null,
        trainingStress: null,
        profile: null,
        segments: Prisma.DbNull,
        category: null,
        generatedAt: new Date(),
      }
    : {
        isRestDay: false,
        restReason: null,
        sourcePath: generated.workout!.path,
        name: generated.workout!.name,
        discipline: generated.workout!.discipline,
        durationMin: generated.workout!.durationMin ?? null,
        intensity: generated.workout!.intensity ?? null,
        trainingStress: generated.workout!.trainingStress ?? null,
        profile: generated.workout!.profile ?? null,
        segments: (generated.workout!.segments as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        category: generated.category,
        generatedAt: new Date(),
      };

  const data = availableHoursOverride !== undefined ? { ...base, availableHoursOverride } : base;

  await prisma.plannedDay.upsert({
    where: { userId_date: { userId, date: generated.date } },
    create: { userId, date: generated.date, ...data },
    update: data,
  });
}

const ROLLING_WINDOW_DAYS = 14;

/** (Re)generates today through the next `days` days for a user with an active plan config. */
export async function generatePlanWindow(userId: string, days = ROLLING_WINDOW_DAYS): Promise<void> {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return;

  const library = await fetchWorkoutLibrary(userId).catch(() => [] as ParsedWorkoutFile[]);

  const today = utcMidnight(new Date());
  const existingToday = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: today } } });
  const todayOverrideHours = existingToday?.availableHoursOverride ?? null;

  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date);
  }

  const generatedDays = await runProjection(userId, dates, config, library, todayOverrideHours);
  for (const generated of generatedDays) {
    const isToday = generated.date.getTime() === today.getTime();
    await upsertPlannedDay(userId, generated, isToday && todayOverrideHours != null ? todayOverrideHours : undefined);
  }
}

/**
 * A one-off "today I actually have X hours" adjustment from the Plan tab's
 * availability slider — re-picks just today's workout (or rest day) against
 * the athlete's real current fitness, without touching the recurring weekly
 * schedule in TrainingPlanConfig or any other day in the window.
 */
export async function setTodayAvailability(userId: string, hours: number) {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return null;

  await ensureWindowGenerated(userId);

  const library = await fetchWorkoutLibrary(userId).catch(() => [] as ParsedWorkoutFile[]);
  const fitness = await computeFitnessSeries(userId);
  const ctl = fitness.length ? fitness[fitness.length - 1].ctl : 0;
  const atl = fitness.length ? fitness[fitness.length - 1].atl : 0;
  const readiness = await getReadinessModifiers(userId);

  const today = utcMidnight(new Date());
  const recentDays = await prisma.plannedDay.findMany({
    where: { userId, date: { lt: today }, isRestDay: false, sourcePath: { not: null } },
    orderBy: { date: 'desc' },
    take: RECENT_PICKS_MEMORY,
    select: { sourcePath: true },
  });
  const recentPicks = recentDays.map((d) => d.sourcePath).filter((p): p is string => !!p);

  const generated = decideDay(today, hours, ctl - atl, config, library, readiness, recentPicks);
  await upsertPlannedDay(userId, generated, hours);

  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: today } } });
}

/** Ensures today's PlannedDay row (and the rest of the rolling window) exists, ignoring an inactive config. */
async function ensureWindowGenerated(userId: string): Promise<boolean> {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return false;

  const today = utcMidnight(new Date());
  const existing = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: today } } });
  if (!existing) await generatePlanWindow(userId);
  return true;
}

export async function getPlannedDay(userId: string, date: Date) {
  const hasConfig = await ensureWindowGenerated(userId);
  if (!hasConfig) return null;
  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: utcMidnight(date) } } });
}

export async function getPlannedWeek(userId: string) {
  const hasConfig = await ensureWindowGenerated(userId);
  if (!hasConfig) return [];

  const today = utcMidnight(new Date());
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 6);
  return prisma.plannedDay.findMany({
    where: { userId, date: { gte: today, lte: end } },
    orderBy: { date: 'asc' },
  });
}

export async function regenerateAllPlans(): Promise<void> {
  const configs = await prisma.trainingPlanConfig.findMany({ select: { userId: true } });
  for (const { userId } of configs) {
    try {
      await generatePlanWindow(userId);
    } catch (err) {
      console.error(`[training-plan] failed to regenerate plan for user ${userId}:`, err);
    }
  }
}
