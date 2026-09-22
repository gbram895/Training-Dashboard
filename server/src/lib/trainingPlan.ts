import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { fetchWorkoutLibrary, type ParsedWorkoutFile, type PlannedDiscipline } from './workoutLibrary.js';
import { CATEGORY_ORDER, estimatedTssForBucket, type WorkoutCategory } from './workoutIntensity.js';
import { computeFitnessSeries } from './fitness.js';
import {
  measureTssPerHour,
  periodizeDay,
  pickAnchor,
  type DayPeriodization,
  type PeriodizationContext,
} from './periodization.js';
import {
  disciplineFor,
  emphasisFor,
  focusLine,
  goalForDay,
  legForDay,
  legsFor,
  selectCategory,
  type GoalLegs,
} from './goalSpecificity.js';

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
//
// This is a CEILING, not a prescription. With a typed goal, lib/goalSpecificity.ts
// picks which session at or below it the athlete most needs; without one, the
// ceiling is taken as the answer, which is all this ever did before.
function categoryFromTsb(tsb: number): WorkoutCategory {
  if (tsb < -5) return 'ENDURANCE';
  if (tsb < 10) return 'TEMPO';
  if (tsb < 25) return 'THRESHOLD';
  return 'VO2MAX';
}

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
  lastRpe: number | null; // RPE (1-10) logged against the most recent workout, if any
  missedHardSessionYesterday: boolean; // yesterday was planned THRESHOLD/VO2MAX but never logged
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

  // Bounded to the last 2 days — a brutal session should ease off tomorrow,
  // not silently suppress intensity for a week until another RPE is logged.
  const rpeSince = new Date();
  rpeSince.setUTCDate(rpeSince.getUTCDate() - 2);
  const lastLoggedWorkout = await prisma.workout.findFirst({
    where: { userId, rpe: { not: null }, date: { gte: rpeSince } },
    orderBy: { date: 'desc' },
    select: { rpe: true },
  });

  // If yesterday's plan called for a key (threshold/VO2max) session and
  // nothing of that discipline was actually logged, don't stack another hard
  // day on top of a broken week rather than assume the fitness curve alone
  // (which, having seen no load, may read as "fresher than expected") has
  // the full picture.
  const yesterday = utcMidnight(new Date());
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const today = utcMidnight(new Date());
  const yesterdayPlan = await prisma.plannedDay.findUnique({
    where: { userId_date: { userId, date: yesterday } },
    select: { isRestDay: true, category: true, discipline: true },
  });
  let missedHardSessionYesterday = false;
  if (yesterdayPlan && !yesterdayPlan.isRestDay && (yesterdayPlan.category === 'THRESHOLD' || yesterdayPlan.category === 'VO2MAX')) {
    const logged = await prisma.workout.findFirst({
      where: {
        userId,
        type: yesterdayPlan.discipline === 'RUN' ? 'RUN' : 'RIDE',
        date: { gte: yesterday, lt: today },
      },
      select: { id: true },
    });
    missedHardSessionYesterday = !logged;
  }

  return { hrvRatio, sleepHours: lastSleep, lastRpe: lastLoggedWorkout?.rpe ?? null, missedHardSessionYesterday };
}

// A brutally hard session (self-reported RPE 9-10) is a stronger, more
// immediate fatigue signal than HRV/sleep can pick up same-day — ease off
// the very next session regardless of what the fitness curve alone says.
const HIGH_RPE_THRESHOLD = 9;

/** The hardest session today's fitness and recovery allow — never exceeded. */
function readinessCeiling(tsb: number | null, readiness: ReadinessModifiers): WorkoutCategory {
  let category = tsb != null ? categoryFromTsb(tsb) : 'TEMPO';

  let downgradeSteps = 0;
  if (readiness.hrvRatio != null && readiness.hrvRatio < 0.8) downgradeSteps += 1;
  if (readiness.sleepHours != null && readiness.sleepHours < 6) downgradeSteps += 1;
  if (readiness.lastRpe != null && readiness.lastRpe >= HIGH_RPE_THRESHOLD) downgradeSteps += 1;
  if (readiness.missedHardSessionYesterday) downgradeSteps += 1;

  if (downgradeSteps > 0) category = downgrade(category, downgradeSteps);
  return category;
}

// Workouts this close together in length fit a given day about equally well,
// so there is no reason to always hand back the same one. Picking strictly
// the closest match is what made a stable weekly schedule produce a stable
// weekly workout — the same Tuesday session, week after week.
const DURATION_TIE_MINUTES = 15;

/**
 * Among the workouts that suit the day about equally well, take a different
 * one on different days.
 *
 * The rotation is seeded from the date rather than randomised, which matters:
 * the plan regenerates several times a day (every sync, every settings change,
 * the nightly rebuild), and a random pick would mean today's session changed
 * under the athlete every time. A date seed gives a day one stable answer and
 * neighbouring days different ones.
 */
function rotateAmongClosest(
  pool: ParsedWorkoutFile[],
  targetMinutes: number,
  seed: number,
): ParsedWorkoutFile {
  const distance = (w: ParsedWorkoutFile) =>
    w.durationMin == null ? Number.POSITIVE_INFINITY : Math.abs(w.durationMin - targetMinutes);
  const best = pool.reduce((a, w) => (distance(w) < distance(a) ? w : a), pool[0]);
  const bestDistance = distance(best);
  if (!Number.isFinite(bestDistance)) return best;

  // Sorted by path so the rotation doesn't depend on the order Dropbox
  // happened to list the library in.
  const equallyGood = pool
    .filter((w) => distance(w) <= bestDistance + DURATION_TIE_MINUTES)
    .sort((a, b) => a.path.localeCompare(b.path));
  return equallyGood[seed % equallyGood.length] ?? best;
}

function pickWorkout(
  library: ParsedWorkoutFile[],
  discipline: PlannedDiscipline,
  targetMinutes: number,
  category: WorkoutCategory,
  avoidPaths: string[],
  seed: number,
): ParsedWorkoutFile | null {
  const byDiscipline = library.filter((w) => w.discipline === discipline);
  if (byDiscipline.length === 0) return null;

  // Never hand back something wildly longer than what was actually scheduled
  // — a 3h ride on a day set for 1h is worse than no ride at all. A workout
  // with no parsed duration can't be checked, so it's let through but ranked
  // last (see distance above), rather than assumed to fit.
  const maxAllowedMinutes = Math.max(targetMinutes * 1.5, targetMinutes + 20);
  const withinTolerance = byDiscipline.filter((w) => w.durationMin == null || w.durationMin <= maxAllowedMinutes);
  if (withinTolerance.length === 0) return null;

  // Prefer a workout not used recently, so a library with several options in
  // the same category doesn't collapse to one repeat — but never refuse to
  // plan a day just to avoid a repeat.
  const pickFrom = (pool: ParsedWorkoutFile[]) => {
    if (pool.length === 0) return null;
    const notRecent = pool.filter((w) => !avoidPaths.includes(w.path));
    return rotateAmongClosest(notRecent.length > 0 ? notRecent : pool, targetMinutes, seed);
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
  /** One line on why this session, when a typed goal drove the choice. */
  focus?: string | null;
  // Where this day sits across all of the athlete's goals, and what that did to
  // its hours. Null when there are none, in which case the plan behaves exactly
  // as it did before periodisation existed.
  periodization?: DayPeriodization | null;
  // Set for a day the athlete has manually rearranged (calendar drag-and-drop)
  // — its content is left alone rather than upserted, see generatePlanWindow.
  skipUpsert?: boolean;
}

interface ManualOverrideRow {
  isRestDay: boolean;
  trainingStress: number | null;
  sourcePath: string | null;
}

const CTL_DECAY = 1 - Math.exp(-1 / 42);
const ATL_DECAY = 1 - Math.exp(-1 / 7);

/**
 * How many recent picks to keep out of the running, scaled to the library:
 * refusing to repeat six workouts is pointless with four in the folder, and
 * remembering only the last two wastes a library of thirty. Never below two,
 * so even a tiny library doesn't hand back the same session twice running.
 */
function recentPicksMemory(libraryCount: number): number {
  return Math.min(6, Math.max(2, Math.floor(libraryCount / 3)));
}

/**
 * What the athlete's goal wants of a given day, when they have one with a type.
 * Null means no typed goal, and the day is decided on fitness and recovery
 * alone — exactly how every day was decided before goal types existed.
 */
interface GoalContext {
  legs: GoalLegs;
  goalName: string;
  emphasis: ReturnType<typeof emphasisFor>;
  isLongDay: boolean;
  /**
   * Session types already planned, oldest first, real history then this
   * window. A single-sport goal measures its mix across the whole week, since
   * its target shares are a whole-week budget; a composed multisport goal
   * measures each leg against its own history, because a triathlete's bike and
   * run budgets are genuinely separate.
   */
  recentCategories: WorkoutCategory[];
  recentByDiscipline: Record<PlannedDiscipline, WorkoutCategory[]>;
  keySessionsSoFar: number;
  /** Training days already given to this goal, so a composed goal alternates legs. */
  disciplineTurns: number;
  /** Week of the plan window, so a long ride and a long run take turns. */
  weekIndex: number;
}

/** Picks a rest day or a specific workout for one day, given its target hours and projected Form. */
function decideDay(
  date: Date,
  targetHours: number,
  tsb: number,
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[] },
  library: ParsedWorkoutFile[],
  readiness: ReadinessModifiers,
  avoidPaths: string[],
  goal: GoalContext | null,
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

  // Fatigue sets the ceiling; the goal picks which session at or below it the
  // athlete most needs. Without a typed goal the ceiling IS the pick, which is
  // the behaviour this had all along.
  const ceiling = readinessCeiling(tsb, readiness);
  const scheduledAsRun = config.runDays.includes(date.getUTCDay());
  // What the athlete's own weekly schedule says this day is, before any goal
  // gets a say.
  const configuredDiscipline: PlannedDiscipline = config.includeRunning && scheduledAsRun ? 'RUN' : 'BIKE';

  let category = ceiling;
  let discipline = configuredDiscipline;
  let focus: string | null = null;

  if (goal) {
    // A composed multisport goal picks its leg first, because which leg the
    // day belongs to is what decides the mix. A single-sport goal goes the
    // other way round: one mix covers the week, and the discipline follows
    // from how hard the session turned out to be.
    const leg: PlannedDiscipline | null = goal.legs.composed
      ? legForDay({
          legs: goal.legs,
          scheduledAsRun,
          includeRunning: config.includeRunning,
          isLongDay: goal.isLongDay,
          disciplineTurns: goal.disciplineTurns,
          weekIndex: goal.weekIndex,
        })
      : null;

    const profile = leg ? (leg === 'RUN' ? goal.legs.run : goal.legs.bike) : (goal.legs.bike ?? goal.legs.run);

    if (profile) {
      const selection = selectCategory({
        ceiling,
        profile,
        emphasis: goal.emphasis,
        recent: leg ? goal.recentByDiscipline[leg] : goal.recentCategories,
        isLongDay: goal.isLongDay,
      });
      category = selection.category;
      discipline =
        leg ??
        disciplineFor({
          profile,
          category,
          isLongDay: goal.isLongDay,
          scheduledAsRun,
          includeRunning: config.includeRunning,
          keySessionsSoFar: goal.keySessionsSoFar,
        });
      if (selection.goalDriven) {
        focus = focusLine({
          profile,
          category,
          emphasis: goal.emphasis,
          goalName: goal.goalName,
          isLongDay: goal.isLongDay,
          leg: goal.legs.composed ? discipline : null,
        });
      }
    }
  }

  const targetMinutes = Math.round(targetHours * 60);
  // Days apart rather than the raw timestamp, so the rotation advances by one
  // per day rather than jumping by 86,400,000.
  const seed = Math.floor(date.getTime() / 86_400_000);
  let workout = pickWorkout(library, discipline, targetMinutes, category, avoidPaths, seed);

  // A day the goal (rather than the athlete's own schedule) turned into a run
  // falls back to the configured discipline when the library has no run that
  // fits. Specificity is worth a lot, but not a blank day: an equivalent ride
  // trains more than a rest day does. A day the athlete themselves marked as a
  // run keeps today's behaviour and says what's missing instead.
  if (!workout && discipline !== configuredDiscipline) {
    workout = pickWorkout(library, configuredDiscipline, targetMinutes, category, avoidPaths, seed);
  }

  return workout
    ? { date, isRestDay: false, workout, category, focus }
    : {
        date,
        isRestDay: true,
        restReason: `No ${discipline === 'RUN' ? 'run' : 'ride'} in your library short enough for ${targetHours}h — add a shorter one, or this stays a rest day`,
      };
}

/**
 * The day of the week the athlete has set aside the most time for, which is
 * the only day a genuinely long session can go. Ties go to the later day, so
 * a Saturday/Sunday pair puts the long one on Sunday rather than Saturday.
 */
function longestScheduledDay(config: PlanConfigHours): { dayOfWeek: number; hours: number } {
  let dayOfWeek = 0;
  let hours = 0;
  for (let d = 0; d < DAY_KEYS.length; d++) {
    const h = config[DAY_KEYS[d]];
    if (h >= hours) {
      dayOfWeek = d;
      hours = h;
    }
  }
  return { dayOfWeek, hours };
}

// Below this there is no such thing as a long session, so no day is treated
// as the week's long day and the goal's other demands get that slot instead.
const LONG_DAY_MIN_HOURS = 1.5;

/**
 * The session types already behind the athlete, so the first day of a
 * regenerated window continues the mix rather than starting from a blank
 * slate. Without this the plan would re-deal the same opening sessions every
 * time it regenerated, which is several times a day.
 */
interface RecentCategories {
  /** Every training day, for a single-sport goal's whole-week mix. */
  all: WorkoutCategory[];
  /** Split by discipline, for a composed multisport goal's per-leg mixes. */
  byDiscipline: Record<PlannedDiscipline, WorkoutCategory[]>;
}

async function recentPlannedCategories(userId: string, today: Date): Promise<RecentCategories> {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 14);
  const rows = await prisma.plannedDay.findMany({
    where: { userId, date: { gte: since, lt: today }, isRestDay: false, category: { not: null } },
    orderBy: { date: 'asc' },
    select: { category: true, discipline: true },
  });

  const recent: RecentCategories = { all: [], byDiscipline: { BIKE: [], RUN: [] } };
  for (const row of rows) {
    const category = row.category as WorkoutCategory;
    if (!CATEGORY_ORDER.includes(category)) continue;
    recent.all.push(category);
    if (row.discipline) recent.byDiscipline[row.discipline].push(category);
  }
  return recent;
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
 * `hourOverrides`, keyed by date, replaces that date's config hours — see
 * setDayAvailability, the only source of these values (the Plan tab's
 * availability slider for today, or the weekly check-in for any day in the
 * window).
 */
async function runProjection(
  userId: string,
  dates: Date[],
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[]; weeklyHours: number },
  library: ParsedWorkoutFile[],
  hourOverrides?: Map<number, number>,
  manualOverrides?: Map<number, ManualOverrideRow>,
): Promise<GeneratedDay[]> {
  const fitness = await computeFitnessSeries(userId);
  let ctl = fitness.length ? fitness[fitness.length - 1].ctl : 0;
  let atl = fitness.length ? fitness[fitness.length - 1].atl : 0;
  const readiness = await getReadinessModifiers(userId);

  // Every goal the athlete has is periodised together, not one at a time — the
  // ramp aims at the season's anchor while any of them can claim a given day
  // for its taper, its race or its recovery. The ramp is re-anchored to the
  // athlete's real, current fitness on every regeneration — see
  // lib/periodization.ts on why both of those matter.
  const targets = await prisma.trainingTarget.findMany({ where: { userId }, orderBy: { date: 'asc' } });
  const periodizationCtx: PeriodizationContext | null = targets.length
    ? {
        targets,
        currentCtl: ctl,
        tssPerHour: await measureTssPerHour(userId),
        weeklyHours: config.weeklyHours,
      }
    : null;

  const today = utcMidnight(new Date());
  const recentPicks: string[] = [];
  const pickMemory = recentPicksMemory(library.length);
  const results: GeneratedDay[] = [];

  // Which goal the ramp points at, and the mix of sessions already behind the
  // athlete — both needed before the first day so the window continues the
  // training that came before it rather than restarting it.
  const anchor = targets.length ? pickAnchor(targets, today) : null;
  const recent = await recentPlannedCategories(userId, today);
  const longDay = longestScheduledDay(config);
  let keySessionsSoFar = 0;
  let disciplineTurns = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const tsb = ctl - atl;
    const override = manualOverrides?.get(date.getTime());
    const periodization = periodizationCtx ? periodizeDay(date, today, periodizationCtx) : null;

    // Which goal's demands this day trains for: normally the anchor, but a day
    // inside another goal's taper belongs to that goal instead.
    const dayGoal = targets.length ? goalForDay(targets, periodization?.targetId ?? null, anchor) : null;
    const legs = dayGoal ? legsFor(dayGoal) : null;
    const goalContext: GoalContext | null =
      dayGoal && legs && (legs.bike || legs.run)
        ? {
            legs,
            goalName: dayGoal.name,
            emphasis: emphasisFor(periodization?.phase ?? null, periodization?.daysToEvent ?? Number.MAX_SAFE_INTEGER),
            isLongDay: date.getUTCDay() === longDay.dayOfWeek && longDay.hours >= LONG_DAY_MIN_HOURS,
            recentCategories: recent.all,
            recentByDiscipline: recent.byDiscipline,
            keySessionsSoFar,
            disciplineTurns,
            weekIndex: Math.floor(i / 7),
          }
        : null;

    // A one-off availability override is the athlete telling us how much time
    // they actually have that day, so the periodisation multiplier is applied
    // to the standing weekly hours only — never to an answer they gave us.
    const explicitHours = hourOverrides?.get(date.getTime());
    const targetHours =
      explicitHours != null ? explicitHours : config[dayKeyFor(date)] * (periodization?.loadMultiplier ?? 1);

    // A manually rearranged day (calendar drag-and-drop) keeps its own
    // content — still fed into the fitness projection below, exactly like a
    // regular planned day, just never regenerated.
    let generated: GeneratedDay;
    if (override) {
      generated = { date, isRestDay: override.isRestDay, skipUpsert: true, periodization };
    } else if (periodization?.phase === 'EVENT') {
      // Race day isn't the plan's to fill in.
      generated = {
        date,
        isRestDay: true,
        restReason: `${periodization.targetName} — today's the day. Nothing else is planned.`,
        periodization,
      };
    } else {
      generated = {
        ...decideDay(date, targetHours, tsb, config, library, readiness, recentPicks, goalContext),
        periodization,
      };
    }
    results.push(generated);

    // Feed this day back into the mix the next one is measured against, so the
    // window converges on the goal's target shares rather than each day being
    // decided in isolation.
    if (!generated.isRestDay && generated.category) {
      recent.all.push(generated.category);
      const placedDiscipline = generated.workout?.discipline;
      if (placedDiscipline) recent.byDiscipline[placedDiscipline].push(generated.category);
      if (generated.category === 'THRESHOLD' || generated.category === 'VO2MAX') keySessionsSoFar++;
      if (goalContext) disciplineTurns++;
    }

    const dayTss = generated.isRestDay
      ? 0
      : estimatedTssForBucket(override ? override.trainingStress : generated.workout?.trainingStress);
    ctl = ctl + (dayTss - ctl) * CTL_DECAY;
    atl = atl + (dayTss - atl) * ATL_DECAY;

    const recentPickPath = override ? (override.isRestDay ? null : override.sourcePath) : generated.workout?.path;
    if (recentPickPath) {
      recentPicks.push(recentPickPath);
      if (recentPicks.length > pickMemory) recentPicks.shift();
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
  const phaseFields = {
    phase: generated.periodization?.phase ?? null,
    phaseWeek: generated.periodization?.phaseWeek ?? null,
    loadMultiplier: generated.periodization
      ? Math.round(generated.periodization.loadMultiplier * 100) / 100
      : null,
  };

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
        focus: null,
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
        focus: generated.focus ?? null,
        generatedAt: new Date(),
      };

  const withPhase = { ...base, ...phaseFields };
  const data = availableHoursOverride !== undefined ? { ...withPhase, availableHoursOverride } : withPhase;

  await prisma.plannedDay.upsert({
    where: { userId_date: { userId, date: generated.date } },
    create: { userId, date: generated.date, ...data },
    update: data,
  });
}

export const ROLLING_WINDOW_DAYS = 14;

/** (Re)generates today through the next `days` days for a user with an active plan config. */
export async function generatePlanWindow(userId: string, days = ROLLING_WINDOW_DAYS): Promise<void> {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return;

  const library = await fetchWorkoutLibrary(userId).catch(() => [] as ParsedWorkoutFile[]);

  const today = utcMidnight(new Date());
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date);
  }

  // A day's own one-off availableHoursOverride (see setDayAvailability) or
  // manualOverride flag (see swapPlannedDays) survives regeneration — read
  // whatever's already on each row before rebuilding the window around it.
  const existingRows = await prisma.plannedDay.findMany({
    where: { userId, date: { in: dates } },
    select: { date: true, isRestDay: true, trainingStress: true, sourcePath: true, manualOverride: true, availableHoursOverride: true },
  });
  const manualOverrides = new Map<number, ManualOverrideRow>();
  const hourOverrides = new Map<number, number>();
  for (const row of existingRows) {
    if (row.manualOverride) {
      manualOverrides.set(row.date.getTime(), {
        isRestDay: row.isRestDay,
        trainingStress: row.trainingStress,
        sourcePath: row.sourcePath,
      });
    }
    if (row.availableHoursOverride != null) hourOverrides.set(row.date.getTime(), row.availableHoursOverride);
  }

  const generatedDays = await runProjection(userId, dates, config, library, hourOverrides, manualOverrides);
  for (const generated of generatedDays) {
    if (generated.skipUpsert) continue;
    await upsertPlannedDay(userId, generated, hourOverrides.get(generated.date.getTime()));
  }
}

/**
 * Swaps the full content (workout/rest, everything but the date itself and
 * its own availability override) of two PlannedDay rows — the calendar
 * drag-and-drop primitive: dragging a workout onto another day, rest or not,
 * naturally becomes "move this workout there" for both sides at once. Both
 * days are marked manualOverride so the nightly regeneration leaves them as
 * the athlete placed them.
 */
export async function swapPlannedDays(userId: string, dateA: Date, dateB: Date) {
  const [a, b] = await Promise.all([
    prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: utcMidnight(dateA) } } }),
    prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: utcMidnight(dateB) } } }),
  ]);
  if (!a || !b) return null;

  const contentOf = (row: NonNullable<typeof a>) => ({
    isRestDay: row.isRestDay,
    restReason: row.restReason,
    sourcePath: row.sourcePath,
    name: row.name,
    discipline: row.discipline,
    durationMin: row.durationMin,
    intensity: row.intensity,
    trainingStress: row.trainingStress,
    profile: row.profile,
    segments: row.segments ?? Prisma.DbNull,
    category: row.category,
    focus: row.focus,
  });

  const [updatedA, updatedB] = await Promise.all([
    prisma.plannedDay.update({
      where: { id: a.id },
      data: { ...contentOf(b), manualOverride: true, generatedAt: new Date() },
    }),
    prisma.plannedDay.update({
      where: { id: b.id },
      data: { ...contentOf(a), manualOverride: true, generatedAt: new Date() },
    }),
  ]);

  return { a: updatedA, b: updatedB };
}

/**
 * Undoes every manually-rearranged day from today onward — clears
 * manualOverride and regenerates, handing those days back to the algorithm
 * (against current fitness/readiness, same as any other regeneration).
 */
export async function revertManualOverrides(userId: string): Promise<void> {
  const today = utcMidnight(new Date());
  await prisma.plannedDay.updateMany({
    where: { userId, date: { gte: today }, manualOverride: true },
    data: { manualOverride: false },
  });
  await generatePlanWindow(userId);
}

/**
 * A one-off "I actually have X hours this day" adjustment — the Plan tab's
 * availability slider (today only) and the Sunday-evening "set next week's
 * availability" check-in (any day already in the rolling window) both go
 * through this. Records the override on that day's row, then re-runs the
 * whole window projection so later days correctly reflect the changed load,
 * without touching the recurring weekly schedule in TrainingPlanConfig.
 */
export async function setDayAvailability(userId: string, date: Date, hours: number) {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return null;

  await ensureWindowGenerated(userId);

  const day = utcMidnight(date);
  const today = utcMidnight(new Date());
  if (day < today) return null;

  const existing = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
  if (!existing) return null;

  await prisma.plannedDay.update({ where: { id: existing.id }, data: { availableHoursOverride: hours } });
  await generatePlanWindow(userId);

  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
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
