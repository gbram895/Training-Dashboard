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

interface ReadinessInputs {
  tsb: number | null;
  hrvRatio: number | null; // last night's HRV vs its own 7-day rolling average
  sleepHours: number | null;
}

async function getReadiness(userId: string, forDate: Date): Promise<ReadinessInputs> {
  const fitness = await computeFitnessSeries(userId);
  const dateKey = forDate.toISOString().slice(0, 10);
  // Use the most recent fitness point at or before the planned date — future
  // days reuse today's most current TSB, since we can't know tomorrow's yet.
  const point = [...fitness].reverse().find((p) => p.date <= dateKey) ?? fitness[fitness.length - 1] ?? null;

  const since = new Date(forDate);
  since.setUTCDate(since.getUTCDate() - 8);
  const days = await prisma.dailyHealthSummary.findMany({
    where: { userId, date: { gte: since, lt: forDate } },
    orderBy: { date: 'asc' },
    select: { avgHrv: true, sleepHours: true },
  });

  const hrvValues = days.map((d) => d.avgHrv).filter((v): v is number => v != null);
  const lastHrv = hrvValues[hrvValues.length - 1] ?? null;
  const baselineHrv = hrvValues.length ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null;
  const hrvRatio = lastHrv != null && baselineHrv ? lastHrv / baselineHrv : null;

  const lastSleep = days.length ? (days[days.length - 1].sleepHours ?? null) : null;

  return { tsb: point?.tsb ?? null, hrvRatio, sleepHours: lastSleep };
}

function decideCategory(readiness: ReadinessInputs): WorkoutCategory {
  let category = readiness.tsb != null ? categoryFromTsb(readiness.tsb) : 'TEMPO';

  let downgradeSteps = 0;
  if (readiness.hrvRatio != null && readiness.hrvRatio < 0.8) downgradeSteps += 1;
  if (readiness.sleepHours != null && readiness.sleepHours < 6) downgradeSteps += 1;

  if (downgradeSteps > 0) category = downgrade(category, downgradeSteps);
  return category;
}

function pickWorkout(
  library: ParsedWorkoutFile[],
  discipline: PlannedDiscipline,
  targetMinutes: number,
  category: WorkoutCategory,
): ParsedWorkoutFile | null {
  const byDiscipline = library.filter((w) => w.discipline === discipline);
  if (byDiscipline.length === 0) return null;

  const closestIn = (pool: ParsedWorkoutFile[]) =>
    pool.reduce((best, w) => {
      const bestDiff = Math.abs((best.durationMin ?? targetMinutes) - targetMinutes);
      const diff = Math.abs((w.durationMin ?? targetMinutes) - targetMinutes);
      return diff < bestDiff ? w : best;
    }, pool[0]);

  const inCategory = byDiscipline.filter((w) => (w.category ?? undefined) === category);
  if (inCategory.length > 0) return closestIn(inCategory);

  // Fall back to the nearest category tier (both directions) before giving up
  // on the category entirely — an easier or harder session beats no session.
  const idx = CATEGORY_ORDER.indexOf(category);
  for (let radius = 1; radius < CATEGORY_ORDER.length; radius++) {
    const candidates = [CATEGORY_ORDER[idx - radius], CATEGORY_ORDER[idx + radius]]
      .filter((c): c is WorkoutCategory => c != null)
      .flatMap((c) => byDiscipline.filter((w) => w.category === c));
    if (candidates.length > 0) return closestIn(candidates);
  }

  return closestIn(byDiscipline);
}

interface GeneratedDay {
  isRestDay: boolean;
  restReason?: string;
  workout?: ParsedWorkoutFile;
  category?: WorkoutCategory;
}

async function generateDay(
  userId: string,
  date: Date,
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[] },
  library: ParsedWorkoutFile[],
): Promise<GeneratedDay> {
  const targetHours = config[dayKeyFor(date)];
  if (!targetHours || targetHours <= 0) {
    return { isRestDay: true, restReason: 'No training hours scheduled today' };
  }

  const readiness = await getReadiness(userId, date);
  if (readiness.tsb != null && readiness.tsb < FORCED_REST_TSB) {
    return { isRestDay: true, restReason: 'Fatigue is running high (low Form) — recovery takes priority today' };
  }

  const category = decideCategory(readiness);
  const discipline: PlannedDiscipline = config.includeRunning && config.runDays.includes(date.getUTCDay()) ? 'RUN' : 'BIKE';
  const targetMinutes = Math.round(targetHours * 60);

  const workout = pickWorkout(library, discipline, targetMinutes, category);
  if (!workout) {
    return {
      isRestDay: true,
      restReason: `No ${discipline === 'RUN' ? 'run' : 'ride'} workouts found in your library`,
    };
  }

  return { isRestDay: false, workout, category };
}

async function upsertPlannedDay(userId: string, date: Date, generated: GeneratedDay) {
  const data = generated.isRestDay
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

  await prisma.plannedDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...data },
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
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    const generated = await generateDay(userId, date, config, library);
    await upsertPlannedDay(userId, date, generated);
  }
}

/** Ensures a single date has a PlannedDay row, generating it on demand if missing. */
export async function ensurePlannedDay(userId: string, date: Date) {
  const day = utcMidnight(date);
  const existing = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
  if (existing) return existing;

  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return null;

  const library = await fetchWorkoutLibrary(userId).catch(() => [] as ParsedWorkoutFile[]);
  const generated = await generateDay(userId, day, config, library);
  await upsertPlannedDay(userId, day, generated);
  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
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
