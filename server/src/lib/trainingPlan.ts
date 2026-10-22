import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { cachedWorkoutLibrary, fetchWorkoutLibrary, type ParsedWorkoutFile, type PlannedDiscipline } from './workoutLibrary.js';
import {
  CATEGORY_ORDER,
  estimateIntensityAndStress,
  estimatedTssForBucket,
  type WorkoutCategory,
  type WorkoutSegment,
} from './workoutIntensity.js';
import { judgeRamp, RAMP_WINDOW_DAYS, type RampBand } from './rampRate.js';
import { computeFitnessSeries } from './fitness.js';
import { sleepQualityScore } from './sleepAnalysis.js';
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
import {
  decideRulebookDay,
  goalFavours,
  RECOVERY_SPLIT,
  rulebookStyle,
  zoneMinutes,
  type Confidence,
  type RulebookDayHistory,
  type RulebookStyle,
} from './rulebook.js';
import {
  localInstant,
  parseTrainingWindows,
  placeSession,
  readCalendar,
  slotForDay,
  type DaySlot,
} from './calendarAvailability.js';

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

/**
 * The same ceiling read for a rulebook day. The bands above only allow VO2max
 * work at a Form of +25, which a normal training week never reaches: run
 * against the rulebook they let no interval session through at all, so the
 * under-6-hour bands, which are built on intervals, came out entirely easy.
 * Here ordinary Form allows the rulebook's session, and only real fatigue
 * holds it back. Every other signal (HRV, sleep, RPE, a missed session, the
 * ramp) still takes its step off exactly as before.
 */
function categoryFromTsbForRulebook(tsb: number): WorkoutCategory {
  if (tsb < -20) return 'ENDURANCE';
  if (tsb < -10) return 'TEMPO';
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
  hrvRatio: number | null; // most recent HRV vs the 7 days before it (null until there is a baseline)
  sleepHours: number | null; // most recent night's sleep
  sleepQuality: number | null; // 0-100 from that night's stage breakdown (null without one)
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
    select: {
      avgHrv: true,
      sleepHours: true,
      sleepDeepHours: true,
      sleepRemHours: true,
      sleepInBedHours: true,
    },
  });

  const hrvValues = days.map((d) => d.avgHrv).filter((v): v is number => v != null);
  const lastHrv = hrvValues[hrvValues.length - 1] ?? null;
  // The baseline deliberately excludes the most recent reading. Averaging it
  // into its own baseline drags the ratio towards 1.0 — and with a single
  // reading in the window the ratio is exactly 1.0, so the low-HRV downgrade
  // below could never fire no matter how far HRV had dropped. Same rule the
  // dashboard's readiness ring uses (client/src/lib/readiness.ts).
  const priorHrv = hrvValues.slice(0, -1);
  const baselineHrv = priorHrv.length ? priorHrv.reduce((a, b) => a + b, 0) / priorHrv.length : null;
  const hrvRatio = lastHrv != null && baselineHrv ? lastHrv / baselineHrv : null;

  const lastNight = days.length ? days[days.length - 1] : null;
  const lastSleep = lastNight?.sleepHours ?? null;
  const lastSleepQuality = lastNight
    ? sleepQualityScore({
        totalHours: lastNight.sleepHours,
        deepHours: lastNight.sleepDeepHours,
        remHours: lastNight.sleepRemHours,
        inBedHours: lastNight.sleepInBedHours,
      })
    : null;

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

  return {
    hrvRatio,
    sleepHours: lastSleep,
    sleepQuality: lastSleepQuality,
    lastRpe: lastLoggedWorkout?.rpe ?? null,
    missedHardSessionYesterday,
  };
}

// A brutally hard session (self-reported RPE 9-10) is a stronger, more
// immediate fatigue signal than HRV/sleep can pick up same-day — ease off
// the very next session regardless of what the fitness curve alone says.
const HIGH_RPE_THRESHOLD = 9;

// A night can be long and still not have recovered anything: mostly light
// sleep, or broken up enough that a third of it was spent awake. Length alone
// could never see that, which is why this sits beside the under-six-hours rule
// rather than replacing it. Deliberately only reachable when the night WAS
// long enough — a short night already costs a step, and taking two for one bad
// night suppresses more training than one night's evidence justifies.
const POOR_SLEEP_QUALITY = 60;

/**
 * The hardest session today's fitness and recovery allow — never exceeded.
 *
 * `ramp` is how fast load is climbing for that day (see lib/rampRate.ts), from
 * the same judgement the dashboard's warning card shows. It earns its place
 * next to the Form bands above rather than duplicating them because the
 * acute:chronic ratio is normalised by fitness: `ratio = 1 - TSB / CTL`, so a
 * Form of -20 is a ratio of 1.67 on a CTL of 30 and 1.22 on a CTL of 90.
 * `categoryFromTsb`'s absolute bands treat those identically; this backs off in
 * the first case and not the second, which is the whole point of asking about
 * ramp rate. It also catches a sustained climb that the ratio alone never sees,
 * because acute and chronic load rise together.
 *
 * It costs one downgrade step, not a rest day. FORCED_REST_TSB above already
 * stops the wheels coming off, and a second independent trigger for forced rest
 * would give a plan that bails out on any hard week.
 */
function readinessCeiling(
  tsb: number | null,
  readiness: ReadinessModifiers,
  ramp: RampBand,
  baseFor: (tsb: number) => WorkoutCategory = categoryFromTsb,
): { category: WorkoutCategory; rampLimited: boolean } {
  const base = tsb != null ? baseFor(tsb) : 'TEMPO';

  let downgradeSteps = 0;
  if (readiness.hrvRatio != null && readiness.hrvRatio < 0.8) downgradeSteps += 1;
  if (readiness.sleepHours != null && readiness.sleepHours < 6) downgradeSteps += 1;
  else if (readiness.sleepQuality != null && readiness.sleepQuality < POOR_SLEEP_QUALITY) downgradeSteps += 1;
  if (readiness.lastRpe != null && readiness.lastRpe >= HIGH_RPE_THRESHOLD) downgradeSteps += 1;
  if (readiness.missedHardSessionYesterday) downgradeSteps += 1;

  const withoutRamp = downgradeSteps > 0 ? downgrade(base, downgradeSteps) : base;
  const rampSpike = ramp === 'SPIKE';
  const category = rampSpike ? downgrade(withoutRamp, 1) : withoutRamp;

  // Only claim the ramp changed something when it actually did — at ENDURANCE
  // there is nothing left to take away, and saying otherwise would put a note
  // on a day that would have looked exactly the same anyway.
  return { category, rampLimited: rampSpike && category !== withoutRamp };
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
  extendTo: number | null = null,
  shuffle = 0,
): ParsedWorkoutFile {
  // A session that will be topped up with steady riding (see extendToFill)
  // fits any day it isn't longer than, so among those length stops being a
  // reason to prefer one over another. Without this the longest file of a type
  // won every big day — and in a JOIN library the longest interval sessions
  // are the "– Lang" race simulations, which is how a week with plenty of time
  // turned into a race simulation every day.
  const fitsByExtension = (w: ParsedWorkoutFile) =>
    extendTo != null && w.durationMin != null && w.durationMin >= MIN_EXTENDABLE_MIN && w.durationMin <= extendTo;
  const distance = (w: ParsedWorkoutFile) =>
    w.durationMin == null
      ? Number.POSITIVE_INFINITY
      : fitsByExtension(w)
        ? 0
        : Math.abs(w.durationMin - targetMinutes);
  const best = pool.reduce((a, w) => (distance(w) < distance(a) ? w : a), pool[0]);
  const bestDistance = distance(best);
  if (!Number.isFinite(bestDistance)) return best;

  // Sorted by path so the rotation doesn't depend on the order Dropbox
  // happened to list the library in.
  const equallyGood = pool
    .filter((w) => distance(w) <= bestDistance + DURATION_TIE_MINUTES)
    .sort((a, b) => a.path.localeCompare(b.path));
  const unshuffled = equallyGood[seed % equallyGood.length] ?? best;
  if (shuffle <= 0) return unshuffled;

  // A shuffle never hands back the session it is replacing. Where only one
  // session suits the day about equally well, the next-closest few are let
  // in, so the button always has somewhere to go.
  let choices = equallyGood;
  if (choices.length < SHUFFLE_MIN_CHOICES) {
    choices = pool
      .filter((w) => Number.isFinite(distance(w)))
      .sort((a, b) => distance(a) - distance(b) || a.path.localeCompare(b.path))
      .slice(0, SHUFFLE_MIN_CHOICES)
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  const others = choices.filter((w) => w.path !== unshuffled.path);
  return others.length ? others[(seed + shuffle - 1) % others.length] : unshuffled;
}

/** How many sessions a shuffle cycles through at least, when the library has them. */
const SHUFFLE_MIN_CHOICES = 5;

// A JOIN interval session is an hour to ninety minutes, and a day can have
// three hours. Picking the closest length left that time unused (a 1h session
// on a 3h day) or, where a longer file existed, always handed back the same
// handful of long race simulations. JOIN's own "Middel" and "Lang" versions
// are built exactly the way this does it: the same intervals with a long
// block of steady riding added. So a session that is clearly shorter than the
// day gets that block, sized to the time there is.
const EXTEND_MIN_GAP_MIN = 20;
// Below this a session is mostly warm-up, and topping it up to three hours
// would turn it into an endurance ride with a few efforts in it.
const MIN_EXTENDABLE_MIN = 45;
// Running volume is what gets people hurt, so a run is only topped up to a
// normal run's length, and to a long run's on the week's long day.
const RUN_EXTEND_CAP_MIN = 90;
const LONG_RUN_EXTEND_CAP_MIN = 150;
// Steady endurance as a fraction of threshold, per how the session is
// prescribed: JOIN's own "duur" riding is 65% of FTP; an easy run sits around
// 80% of threshold speed or heart rate.
const STEADY_FRACTION: Record<NonNullable<WorkoutSegment['targetMetric']>, number> = {
  power: 0.65,
  pace: 0.8,
  hr: 0.8,
};

/** How long a session may be topped up to on this day, or null when it may not be. */
function extendableTo(discipline: PlannedDiscipline, targetMinutes: number, isLongDay: boolean): number | null {
  const cap = discipline === 'RUN' ? (isLongDay ? LONG_RUN_EXTEND_CAP_MIN : RUN_EXTEND_CAP_MIN) : targetMinutes;
  const limit = Math.min(targetMinutes, cap);
  return limit >= MIN_EXTENDABLE_MIN + EXTEND_MIN_GAP_MIN ? limit : null;
}

/**
 * The workout with a block of steady riding (or running) added so it fills
 * `extendTo` minutes, or null when it is already close enough or can't be
 * extended. The block goes in before the cool-down, where JOIN puts it.
 */
function extendToFill(
  workout: ParsedWorkoutFile,
  extendTo: number,
): { workout: ParsedWorkoutFile; addedMin: number } | null {
  const segments = workout.segments;
  if (workout.durationMin == null || !segments?.length) return null;
  const addedMin = extendTo - workout.durationMin;
  if (addedMin < EXTEND_MIN_GAP_MIN) return null;

  const metric =
    segments.find((s) => s.targetMetric != null)?.targetMetric ?? (workout.discipline === 'RUN' ? 'pace' : 'power');
  const steady = STEADY_FRACTION[metric];
  const band = metric === 'power' ? 0.05 : 0.03;

  // The cool-down is the run of easy steps at the very end.
  let insertAt = segments.length;
  while (
    insertAt > 0 &&
    (segments[insertAt - 1].role === 'cooldown' ||
      (segments[insertAt - 1].intensityFraction != null && segments[insertAt - 1].intensityFraction! < steady))
  ) {
    insertAt--;
  }
  // An all-easy session has no distinct cool-down; keep its last step last.
  if (insertAt === 0) insertAt = Math.max(0, segments.length - 1);

  const block: WorkoutSegment = {
    durationSec: addedMin * 60,
    intensityFraction: steady,
    intensityLow: steady - band,
    intensityHigh: steady + band,
    targetMetric: metric,
  };
  const extended = [...segments.slice(0, insertAt), block, ...segments.slice(insertAt)];
  return {
    workout: {
      ...workout,
      segments: extended,
      durationMin: workout.durationMin + addedMin,
      // The session's character (its core effort) doesn't change, but its load does.
      trainingStress: estimateIntensityAndStress(extended).trainingStress ?? workout.trainingStress,
    },
    addedMin,
  };
}

/**
 * What counts as "the same workout" for the don't-repeat memory. JOIN exports
 * one workout at several lengths as separate files — nine "2x 15 min
 * omslagpunt" files that differ only in warm-up, or "Parijs-criterium – Kort",
 * "– Middel" and "– Lang" — so keying the memory on the file path let the plan
 * hand back the same session on consecutive days in a different length.
 */
export function workoutFamily(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+[–-]\s+(kort|middel|med|lang)$/, '');
}

export interface RecentPick {
  path: string;
  family: string;
}

interface PickResult {
  workout: ParsedWorkoutFile;
  /** The session type of what was actually picked, which a variety swap can move off the asked-for one. */
  category: WorkoutCategory;
  /** A one-line note when the pick isn't what the day asked for, or is a repeat. */
  note: string | null;
}

function pickWorkout(
  library: ParsedWorkoutFile[],
  discipline: PlannedDiscipline,
  targetMinutes: number,
  category: WorkoutCategory,
  ceiling: WorkoutCategory,
  recent: RecentPick[],
  seed: number,
  hardMaxMinutes?: number,
  extendTo: number | null = null,
  shuffle = 0,
): PickResult | null {
  const byDiscipline = library.filter((w) => w.discipline === discipline);
  if (byDiscipline.length === 0) return null;

  // Never hand back something wildly longer than what was actually scheduled
  // — a 3h ride on a day set for 1h is worse than no ride at all. A workout
  // with no parsed duration can't be checked, so it's let through but ranked
  // last (see distance above), rather than assumed to fit.
  //
  // A gap in the athlete's calendar is a wall rather than a guide, though:
  // the hour between work and dinner does not stretch to 80 minutes, so there
  // the tolerance stops at the gap, and a workout of unknown length can't be
  // trusted to fit it.
  //
  // An hour is never "wildly longer", though. JOIN sessions start at about an
  // hour, so without that floor a 35-minute recovery-week day had nothing to
  // pick from and became a rest day.
  const maxAllowedMinutes = Math.min(
    Math.max(targetMinutes * 1.5, targetMinutes + 20, SHORT_DAY_FLOOR_MIN),
    hardMaxMinutes ?? Infinity,
  );
  const withinTolerance = byDiscipline.filter((w) =>
    w.durationMin == null ? hardMaxMinutes == null : w.durationMin <= maxAllowedMinutes,
  );
  if (withinTolerance.length === 0) return null;

  const recentPaths = new Set(recent.map((r) => r.path));
  const recentFamilies = new Set(recent.map((r) => r.family));
  const isFresh = (w: ParsedWorkoutFile) => !recentPaths.has(w.path) && !recentFamilies.has(workoutFamily(w.name));
  const ofCategory = (c: WorkoutCategory) => withinTolerance.filter((w) => (w.category ?? undefined) === c);
  const result = (workout: ParsedWorkoutFile, note: string | null = null, placed = category): PickResult => ({
    workout,
    category: placed,
    note,
  });

  const inCategory = ofCategory(category);
  const freshInCategory = inCategory.filter(isFresh);
  // A shuffle on a day with only one session of its type that fits has
  // nowhere to go inside that type, so it looks one type over, the same way an
  // exhausted type does below. Otherwise the button would do nothing.
  const nothingToShuffleTo = shuffle > 0 && freshInCategory.length === 1;
  if (freshInCategory.length > 0 && !nothingToShuffleTo) {
    return result(rotateAmongClosest(freshInCategory, targetMinutes, seed, extendTo, shuffle));
  }

  if (inCategory.length > 0) {
    // Everything of this type that fits the day was used in the last few days.
    // A library can be big and still thin in one corner — at the time of
    // writing, a 230-ride library held exactly one endurance ride under 90
    // minutes — and repeating it is what put the same session on the plan
    // three times in a week. A different session type at or below what
    // fatigue allows beats a repeat: the ceiling stays the ceiling, and the
    // next day's mix sees what was actually placed and corrects for it.
    // Easier types are tried before harder ones at the same distance.
    const idx = CATEGORY_ORDER.indexOf(category);
    const ceilingIdx = CATEGORY_ORDER.indexOf(ceiling);
    for (let radius = 1; radius < CATEGORY_ORDER.length; radius++) {
      for (const i of [idx - radius, idx + radius]) {
        if (i < 0 || i > ceilingIdx || i >= CATEGORY_ORDER.length) continue;
        const alternative = CATEGORY_ORDER[i];
        const fresh = ofCategory(alternative).filter(isFresh);
        if (fresh.length > 0) {
          return result(
            rotateAmongClosest(fresh, targetMinutes, seed, extendTo, shuffle),
            `${alternative === 'ENDURANCE' ? 'An' : 'A'} ${alternative.toLowerCase()} session instead of ${category.toLowerCase()}: ` +
              (nothingToShuffleTo
                ? `your library has only one ${category.toLowerCase()} ${discipline === 'RUN' ? 'run' : 'ride'} that fits ` +
                  `${formatMinutes(targetMinutes)}, so the shuffle looked one type over.`
                : `every ${category.toLowerCase()} ${discipline === 'RUN' ? 'run' : 'ride'} in your library that fits ` +
                  `${formatMinutes(targetMinutes)} was used in the last few days.`),
            alternative,
          );
        }
      }
    }

    if (nothingToShuffleTo) {
      return result(
        freshInCategory[0],
        `Nothing to shuffle to: this is the only ${discipline === 'RUN' ? 'run' : 'ride'} in your library ` +
          `that fits ${formatMinutes(targetMinutes)} today.`,
      );
    }

    // Nothing else fits either, so the repeat stands — but say so, so a thin
    // corner of the library reads as a gap to fill rather than a broken plan.
    const fitting = new Set(inCategory.map((w) => workoutFamily(w.name))).size;
    return result(
      rotateAmongClosest(inCategory, targetMinutes, seed, extendTo, shuffle),
      `A repeat: your library has ${fitting === 1 ? 'only one' : `only ${fitting}`} ` +
        `${category.toLowerCase()} ${discipline === 'RUN' ? 'run' : 'ride'}${fitting === 1 ? '' : 's'} that ` +
        `fit${fitting === 1 ? 's' : ''} ${formatMinutes(targetMinutes)}. Adding a few more would give this day some variety.`,
    );
  }

  // No workout of this type fits at all: fall back to the nearest category
  // tier (both directions) before giving up on the category entirely — an
  // easier or harder session beats no session.
  const pickFrom = (pool: ParsedWorkoutFile[]) => {
    if (pool.length === 0) return null;
    const fresh = pool.filter(isFresh);
    return result(rotateAmongClosest(fresh.length > 0 ? fresh : pool, targetMinutes, seed, extendTo, shuffle));
  };
  const idx = CATEGORY_ORDER.indexOf(category);
  for (let radius = 1; radius < CATEGORY_ORDER.length; radius++) {
    const candidates = [CATEGORY_ORDER[idx - radius], CATEGORY_ORDER[idx + radius]]
      .filter((c): c is WorkoutCategory => c != null)
      .flatMap((c) => ofCategory(c));
    if (candidates.length > 0) return pickFrom(candidates);
  }

  return pickFrom(withinTolerance);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

interface GeneratedDay {
  date: Date;
  isRestDay: boolean;
  restReason?: string;
  workout?: ParsedWorkoutFile;
  category?: WorkoutCategory;
  /** One line on why this session, when a typed goal drove the choice. */
  focus?: string | null;
  /** The rulebook template this session is, and the rulebook's confidence in the day. */
  templateId?: string | null;
  confidence?: Confidence | null;
  confidenceNote?: string | null;
  /** When in the day it goes, when the athlete's windows or calendar say. */
  plannedStart?: Date | null;
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
  name: string | null;
}

/**
 * Today's planned row once the athlete has trained today. The day is over as
 * far as the plan is concerned: it keeps what was asked for (the "Against the
 * plan" review reads it) and the rest of the window is planned around it.
 */
interface CompletedDayRow {
  isRestDay: boolean;
  sourcePath: string | null;
  name: string | null;
  discipline: PlannedDiscipline | null;
  durationMin: number | null;
  category: string | null;
  templateId: string | null;
  segments: Prisma.JsonValue;
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

/**
 * What the training rulebook needs to decide a bike day (see lib/rulebook.ts).
 * Null leaves the day to the goal mix, as before the rulebook existed.
 */
interface RulebookContext {
  style: RulebookStyle;
  /** The day is in a recovery week or straight after a race, which keeps its easy mix. */
  recovering: boolean;
  /** Bike days before this one, real plan history then this window. */
  history: RulebookDayHistory[];
  ftpWatts: number;
}

/** Picks a rest day or a specific workout for one day, given its target hours and projected Form. */
function decideDay(
  date: Date,
  targetHours: number,
  tsb: number,
  ramp: RampBand,
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[] },
  library: ParsedWorkoutFile[],
  readiness: ReadinessModifiers,
  recentPicks: RecentPick[],
  goal: GoalContext | null,
  disciplineOverride?: PlannedDiscipline,
  hardMaxMinutes?: number,
  isLongDay = false,
  shuffle = 0,
  rulebook: RulebookContext | null = null,
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
  const { category: ceiling, rampLimited } = readinessCeiling(tsb, readiness, ramp);
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

  // An easier session than the week called for, with no explanation, is how a
  // plan gets ignored. `focus` is the existing one-line "why this session"
  // field the Plan tab already renders under "Why this workout?", so saying it
  // here needs no new column — and it goes first, because on a day the ramp
  // pulled back, why it is easier matters more than which demand it trains.
  if (rampLimited) {
    const note =
      `Eased off to a ${category.toLowerCase()} session: your load has climbed sharply against ` +
      `what you have been absorbing.`;
    focus = focus ? `${note} ${focus}` : note;
  }

  // The athlete's own explicit "make this a run instead" (or vice versa) —
  // from the Suggested Training card, not the algorithm — wins over whatever
  // the schedule or a goal would otherwise have picked.
  if (disciplineOverride) discipline = disciplineOverride;

  // The rulebook covers cycling only, so it plans every bike day and leaves
  // runs to the logic below (Bram, 2026-10-19: runs keep today's logic). A
  // goal contested on foot, or in both disciplines, still decides which days
  // are runs above; once a day is a ride, the rulebook picks the session.
  if (rulebook && discipline === 'BIKE') {
    const rulebookCeiling = readinessCeiling(tsb, readiness, ramp, categoryFromTsbForRulebook);
    return decideRulebookBikeDay(
      date,
      targetHours,
      rulebookCeiling.category,
      rulebookCeiling.rampLimited,
      library,
      recentPicks,
      goal,
      rulebook,
      hardMaxMinutes,
      isLongDay,
      shuffle,
    );
  }

  const targetMinutes = Math.round(targetHours * 60);
  // Days apart rather than the raw timestamp, so the rotation advances by one
  // per day rather than jumping by 86,400,000.
  const seed = Math.floor(date.getTime() / 86_400_000);
  const pickFor = (d: PlannedDiscipline) =>
    pickWorkout(
      library,
      d,
      targetMinutes,
      category,
      ceiling,
      recentPicks,
      seed,
      hardMaxMinutes,
      extendableTo(d, targetMinutes, isLongDay),
      shuffle,
    );
  let pick = pickFor(discipline);

  // A day the goal (rather than the athlete's own schedule) turned into a run
  // falls back to the configured discipline when the library has no run that
  // fits. Specificity is worth a lot, but not a blank day: an equivalent ride
  // trains more than a rest day does. A day the athlete themselves marked as a
  // run keeps today's behaviour and says what's missing instead. Same logic
  // for an explicit disciplineOverride: falling back would silently ignore
  // what the athlete just asked for, so it stays put and says what's missing.
  if (!pick && discipline !== configuredDiscipline && !disciplineOverride) {
    pick = pickFor(configuredDiscipline);
  }

  if (pick?.note) {
    // A swapped session type makes the goal's "why" line wrong, so the note
    // replaces it; a repeat keeps it and says why it is a repeat.
    focus = pick.category !== category ? pick.note : focus ? `${focus} ${pick.note}` : pick.note;
  }

  // Fill the day: a session clearly shorter than the time there is gets a
  // block of steady riding or running, rather than leaving hours unused.
  if (pick) {
    const extendTo = extendableTo(pick.workout.discipline, targetMinutes, isLongDay);
    const extended = extendTo != null ? extendToFill(pick.workout, extendTo) : null;
    if (extended) {
      pick = { ...pick, workout: extended.workout };
      const note =
        `Includes ${formatMinutes(extended.addedMin)} of steady ` +
        `${pick.workout.discipline === 'RUN' ? 'running' : 'riding'} before the cool-down, to use the time you have.`;
      focus = focus ? `${focus} ${note}` : note;
    }
  }

  return pick
    ? { date, isRestDay: false, workout: pick.workout, category: pick.category, focus }
    : {
        date,
        isRestDay: true,
        restReason: `No ${discipline === 'RUN' ? 'run' : 'ride'} in your library short enough for ${targetHours}h — add a shorter one, or this stays a rest day`,
      };
}

/**
 * A bike day decided by the training rulebook: the zone the week's time split
 * owes, the template that fills it (a matching JOIN file first, else built),
 * and the confidence note the rulebook asks every session to carry. The
 * fatigue ceiling, the ramp note and the fill-the-day block work exactly as
 * they do for any other day.
 */
function decideRulebookBikeDay(
  date: Date,
  targetHours: number,
  ceiling: WorkoutCategory,
  rampLimited: boolean,
  library: ParsedWorkoutFile[],
  recentPicks: RecentPick[],
  goal: GoalContext | null,
  rulebook: RulebookContext,
  hardMaxMinutes: number | undefined,
  isLongDay: boolean,
  shuffle: number,
): GeneratedDay {
  // A JOIN ride already planned in the last seven days stays out, on top of
  // the usual repeat memory, so the day gets a built session instead.
  const weekAgo = date.getTime() - 6 * 86_400_000;
  const thisWeek = rulebook.history.filter((h) => h.date.getTime() >= weekAgo && h.date.getTime() < date.getTime());
  const recentPaths = new Set([...recentPicks.map((r) => r.path), ...thisWeek.flatMap((h) => (h.path ? [h.path] : []))]);
  const recentFamilies = new Set([
    ...recentPicks.map((r) => r.family),
    ...thisWeek.flatMap((h) => (h.path && !h.path.startsWith('rulebook:') ? [workoutFamily(h.name ?? h.path)] : [])),
  ]);
  const goalKind = goal?.legs.bike?.kind ?? null;
  const targetMinutes = Math.round(targetHours * 60);

  const pick = decideRulebookDay({
    date,
    style: rulebook.style,
    split: rulebook.recovering ? RECOVERY_SPLIT : rulebook.style.split,
    history: rulebook.history,
    ceiling,
    targetMinutes,
    hardMaxMinutes,
    goalKind,
    longDayForGoal: isLongDay && (goal?.legs.bike?.longSessionMatters ?? false),
    library: library.filter((w) => w.discipline === 'BIKE'),
    isFresh: (w) => !recentPaths.has(w.path) && !recentFamilies.has(workoutFamily(w.name)),
    ftpWatts: rulebook.ftpWatts,
    seed: Math.floor(date.getTime() / 86_400_000),
    shuffle,
  });

  const notes: string[] = [];
  if (rampLimited) {
    notes.push('Eased off: your load has climbed sharply against what you have been absorbing.');
  }
  notes.push(pick.reason);
  if (goal && pick.template && goalKind && goalFavours(goalKind, pick.template.id)) {
    notes.push(`${pick.template.id} is picked with ${goal.goalName} in mind.`);
  }

  // A built session gets the date in its path, so the .fit download of a
  // given day finds that day's steps rather than another day's version.
  let workout = pick.fromLibrary
    ? pick.workout
    : { ...pick.workout, path: `${pick.workout.path}@${date.toISOString().slice(0, 10)}` };
  // A built endurance ride is already the length of the day, so only a
  // template or a library ride can come up short of it.
  const extendTo = extendableTo('BIKE', targetMinutes, isLongDay);
  const extended = extendTo != null ? extendToFill(workout, extendTo) : null;
  if (extended) {
    workout = extended.workout;
    notes.push(`Includes ${formatMinutes(extended.addedMin)} of steady riding before the cool-down, to use the time you have.`);
  }

  return {
    date,
    isRestDay: false,
    workout,
    category: workout.category ?? 'ENDURANCE',
    focus: notes.join(' '),
    templateId: pick.template?.id ?? null,
    confidence: pick.confidence,
    confidenceNote: pick.confidenceNote,
  };
}

/** The weekly hours the rulebook's band is read from: the athlete's standing schedule. */
export function standingWeeklyHours(config: PlanConfigHours & { weeklyHours: number }): number {
  const scheduled = DAY_KEYS.reduce((sum, key) => sum + (config[key] ?? 0), 0);
  return scheduled > 0 ? scheduled : config.weeklyHours;
}

/** The bike days just before `today`, as the rulebook measures its week against. */
async function recentRulebookHistory(userId: string, today: Date): Promise<RulebookDayHistory[]> {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 7);
  const rows = await prisma.plannedDay.findMany({
    where: { userId, date: { gte: since, lt: today }, isRestDay: false, discipline: 'BIKE' },
    orderBy: { date: 'asc' },
    select: { date: true, segments: true, durationMin: true, category: true, templateId: true, sourcePath: true, name: true },
  });
  return rows.map((r) => {
    const category = CATEGORY_ORDER.includes(r.category as WorkoutCategory) ? (r.category as WorkoutCategory) : null;
    return {
      date: r.date,
      minutes: zoneMinutes(r.segments as WorkoutSegment[] | null, r.durationMin, category),
      category,
      templateId: r.templateId,
      path: r.sourcePath,
      name: r.name,
    };
  });
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

/** The workouts planned on the days just before `today`, oldest first. */
async function recentPlannedPicks(userId: string, today: Date): Promise<RecentPick[]> {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 7);
  const rows = await prisma.plannedDay.findMany({
    where: { userId, date: { gte: since, lt: today }, isRestDay: false, sourcePath: { not: null } },
    orderBy: { date: 'asc' },
    select: { sourcePath: true, name: true },
  });
  return rows.map((r) => ({ path: r.sourcePath!, family: workoutFamily(r.name ?? r.sourcePath!) }));
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
 * window). `disciplineOverrides` likewise forces that date's discipline (run
 * vs. bike) — see setDayDiscipline.
 */
async function runProjection(
  userId: string,
  dates: Date[],
  config: PlanConfigHours & { includeRunning: boolean; runDays: number[]; weeklyHours: number },
  library: ParsedWorkoutFile[],
  hourOverrides?: Map<number, number>,
  manualOverrides?: Map<number, ManualOverrideRow>,
  disciplineOverrides?: Map<number, PlannedDiscipline>,
  slots?: Map<number, DaySlot>,
  shuffles?: Map<number, number>,
  completedToday?: CompletedDayRow | null,
): Promise<GeneratedDay[]> {
  const today = utcMidnight(new Date());
  // Everything the projection starts from, read side by side: each is its own
  // query and none needs another's answer.
  const [fitness, readiness, targets, tssPerHour, plannedPicks, recent, athlete, rulebookHistory] = await Promise.all([
    computeFitnessSeries(userId),
    getReadinessModifiers(userId),
    prisma.trainingTarget.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    measureTssPerHour(userId),
    recentPlannedPicks(userId, today),
    recentPlannedCategories(userId, today),
    prisma.user.findUnique({ where: { id: userId }, select: { trainingLevel: true, ftpWatts: true } }),
    recentRulebookHistory(userId, today),
  ]);
  // The rulebook picks its band from the standing weekly schedule, not from
  // each week's hours: a recovery week or a taper is shorter, not a different
  // way of training. See lib/rulebook.ts.
  const style = rulebookStyle(standingWeeklyHours(config), athlete?.trainingLevel ?? 'RECREATIONAL');
  let ctl = fitness.length ? fitness[fitness.length - 1].ctl : 0;
  let atl = fitness.length ? fitness[fitness.length - 1].atl : 0;
  // The real CTL curve, extended day by day as the window is projected, so the
  // ramp rate the plan reacts to is measured over a real seven days rather than
  // over however much of the window has been generated so far.
  const ctlTrail: number[] = fitness.map((p) => p.ctl);

  // Every goal the athlete has is periodised together, not one at a time — the
  // ramp aims at the season's anchor while any of them can claim a given day
  // for its taper, its race or its recovery. The ramp is re-anchored to the
  // athlete's real, current fitness on every regeneration — see
  // lib/periodization.ts on why both of those matter.
  const periodizationCtx: PeriodizationContext | null = targets.length
    ? {
        targets,
        currentCtl: ctl,
        tssPerHour,
        weeklyHours: config.weeklyHours,
      }
    : null;

  const pickMemory = recentPicksMemory(library.length);
  // Seeded with the days just behind the window, which is what today's own
  // pick is judged against. Without this, today was always picked with an
  // empty memory — and so, on any day with only a few fitting workouts, was
  // the same session it had been yesterday and the day before.
  const recentPicks: RecentPick[] = plannedPicks.slice(-pickMemory);
  const results: GeneratedDay[] = [];

  // Which goal the ramp points at, and the mix of sessions already behind the
  // athlete — both needed before the first day so the window continues the
  // training that came before it rather than restarting it.
  const anchor = targets.length ? pickAnchor(targets, today) : null;
  const longDay = longestScheduledDay(config);
  let keySessionsSoFar = 0;
  let disciplineTurns = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const tsb = ctl - atl;
    // Judged afresh each day off the running projection rather than taken as a
    // snapshot, so a plan that eases off watches the ratio come back down and
    // lets the sessions build again — the same reason TSB is projected here.
    // `ctlTrail` carries the real curve in behind the window, so the ramp rate
    // is measured across the seam rather than starting from zero on day one.
    const { band: ramp } = judgeRamp({
      ctl,
      atl,
      ctlWeekAgo: ctlTrail.length > RAMP_WINDOW_DAYS ? ctlTrail[ctlTrail.length - 1 - RAMP_WINDOW_DAYS] : null,
    });
    const override = manualOverrides?.get(date.getTime());
    const periodization = periodizationCtx ? periodizeDay(date, today, periodizationCtx) : null;

    // Which goal's demands this day trains for: normally the anchor, but a day
    // inside another goal's taper belongs to that goal instead.
    const isLongDay = date.getUTCDay() === longDay.dayOfWeek && longDay.hours >= LONG_DAY_MIN_HOURS;
    const dayGoal = targets.length ? goalForDay(targets, periodization?.targetId ?? null, anchor) : null;
    const legs = dayGoal ? legsFor(dayGoal) : null;
    const goalContext: GoalContext | null =
      dayGoal && legs && (legs.bike || legs.run)
        ? {
            legs,
            goalName: dayGoal.name,
            emphasis: emphasisFor(periodization?.phase ?? null, periodization?.daysToEvent ?? Number.MAX_SAFE_INTEGER),
            isLongDay,
            recentCategories: recent.all,
            recentByDiscipline: recent.byDiscipline,
            keySessionsSoFar,
            disciplineTurns,
            weekIndex: Math.floor(i / 7),
          }
        : null;

    // Already trained today: the day stays as it was planned. Re-deciding it
    // would judge today against a Form that already has today's ride in it,
    // which lands on a different (usually easier) session, and the plan then
    // offered that as the workout still to do. The ride is in the fitness
    // series' last point already, so the projection isn't advanced for it a
    // second time; the session still counts in the mix the next days follow.
    if (i === 0 && completedToday) {
      results.push({ date, isRestDay: completedToday.isRestDay, skipUpsert: true, periodization });
      if (!completedToday.isRestDay) {
        const category = CATEGORY_ORDER.includes(completedToday.category as WorkoutCategory)
          ? (completedToday.category as WorkoutCategory)
          : null;
        if (completedToday.discipline === 'BIKE') {
          rulebookHistory.push({
            date,
            minutes: zoneMinutes(completedToday.segments as WorkoutSegment[] | null, completedToday.durationMin, category),
            category,
            templateId: completedToday.templateId,
            path: completedToday.sourcePath,
            name: completedToday.name,
          });
        }
        if (category) {
          recent.all.push(category);
          if (completedToday.discipline) recent.byDiscipline[completedToday.discipline].push(category);
          if (category === 'THRESHOLD' || category === 'VO2MAX') keySessionsSoFar++;
          if (goalContext) disciplineTurns++;
        }
        if (completedToday.sourcePath) {
          recentPicks.push({
            path: completedToday.sourcePath,
            family: workoutFamily(completedToday.name ?? completedToday.sourcePath),
          });
          if (recentPicks.length > pickMemory) recentPicks.shift();
        }
      }
      continue;
    }

    // A one-off availability override is the athlete telling us how much time
    // they actually have that day, so the periodisation multiplier is applied
    // to the standing weekly hours only — never to an answer they gave us.
    const explicitHours = hourOverrides?.get(date.getTime());
    const targetHours =
      explicitHours != null ? explicitHours : config[dayKeyFor(date)] * (periodization?.loadMultiplier ?? 1);

    // The day is sized by the hours the athlete set for it, never by their
    // calendar or training windows (Bram's call, 2026-10-19): those only
    // suggest when in the day the session goes.
    const slot = slots?.get(date.getTime());

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
        ...decideDay(
          date,
          targetHours,
          tsb,
          ramp,
          config,
          library,
          readiness,
          recentPicks,
          goalContext,
          disciplineOverrides?.get(date.getTime()),
          undefined,
          isLongDay,
          shuffles?.get(date.getTime()) ?? 0,
          {
            style,
            recovering: periodization?.phase === 'RECOVERY' || periodization?.phase === 'POST_RACE',
            history: rulebookHistory,
            ftpWatts: athlete?.ftpWatts ?? 200,
          },
        ),
        periodization,
      };
      if (!generated.isRestDay && slot) {
        const minutes = generated.workout?.durationMin ?? Math.round(targetHours * 60);
        // Only a day the athlete gave hours for gets a time: on a day with
        // no windows of its own the any-time default would put everything at
        // six in the morning, which nobody asked for.
        if (slot.hasOwnWindows) generated.plannedStart = placeSession(slot, minutes);
      }
    }
    results.push(generated);

    // Feed this day back into the mix the next one is measured against, so the
    // window converges on the goal's target shares rather than each day being
    // decided in isolation.
    if (!generated.isRestDay && generated.workout?.discipline === 'BIKE') {
      rulebookHistory.push({
        date,
        minutes: zoneMinutes(generated.workout.segments, generated.workout.durationMin, generated.category),
        category: generated.category ?? null,
        templateId: generated.templateId ?? null,
        path: generated.workout.path,
        name: generated.workout.name,
      });
    }
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
    ctlTrail.push(ctl);

    const recentPick: RecentPick | null = override
      ? override.isRestDay || !override.sourcePath
        ? null
        : { path: override.sourcePath, family: workoutFamily(override.name ?? override.sourcePath) }
      : generated.workout
        ? { path: generated.workout.path, family: workoutFamily(generated.workout.name) }
        : null;
    if (recentPick) {
      recentPicks.push(recentPick);
      if (recentPicks.length > pickMemory) recentPicks.shift();
    }
  }

  return results;
}

/**
 * `availableHoursOverride`/`disciplineOverride`: pass a value to record it on
 * the row, or omit it entirely to leave the column untouched — the normal
 * rolling-window regeneration path never sets these itself, so an existing
 * override survives a regeneration it wasn't the direct cause of (e.g. the
 * user editing next week's hours later the same day).
 */
async function upsertPlannedDay(
  userId: string,
  generated: GeneratedDay,
  availableHoursOverride?: number,
  disciplineOverride?: PlannedDiscipline,
) {
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
        templateId: null,
        confidence: null,
        confidenceNote: null,
        plannedStart: null,
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
        templateId: generated.templateId ?? null,
        confidence: generated.confidence ?? null,
        confidenceNote: generated.confidenceNote ?? null,
        plannedStart: generated.plannedStart ?? null,
        generatedAt: new Date(),
      };

  const withPhase = { ...base, ...phaseFields };
  const data = {
    ...withPhase,
    ...(availableHoursOverride !== undefined ? { availableHoursOverride } : {}),
    ...(disciplineOverride !== undefined ? { disciplineOverride } : {}),
  };

  await prisma.plannedDay.upsert({
    where: { userId_date: { userId, date: generated.date } },
    create: { userId, date: generated.date, ...data },
    update: data,
  });
}

export const ROLLING_WINDOW_DAYS = 14;

/**
 * Each day's free time, for the days that have any say in it: every day once a
 * calendar is connected (with the any-time default where the athlete set no
 * window), otherwise only the weekdays they gave windows for. Empty when
 * neither exists, which leaves the plan exactly as it was before.
 */
async function daySlots(
  userId: string,
  dates: Date[],
  storedWindows: Prisma.JsonValue | null,
  calendarMaxAgeMs?: number,
): Promise<Map<number, DaySlot>> {
  const slots = new Map<number, DaySlot>();
  if (dates.length === 0) return slots;
  const windows = parseTrainingWindows(storedWindows);
  const end = new Date(dates[dates.length - 1]);
  end.setUTCDate(end.getUTCDate() + 1);
  const calendar = await readCalendar(userId, localInstant(dates[0], '00:00'), localInstant(end, '00:00'), {
    maxAgeMs: calendarMaxAgeMs,
  });

  for (const date of dates) {
    const own = windows?.[String(date.getUTCDay())];
    if (!calendar.connected && !own?.length) continue;
    slots.set(date.getTime(), slotForDay(date, windows, calendar.events));
  }
  return slots;
}

/** Without a calendar gap capping the day, a session up to this long is always allowed. */
const SHORT_DAY_FLOOR_MIN = 60;

/**
 * Whether anything was logged on this (local) day, the same test the
 * dashboard uses to show today's session as done. Walks don't count: the
 * watch records the walk to the shops, and that isn't the session.
 */
export async function hasTrainedOn(userId: string, day: Date): Promise<boolean> {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  const workout = await prisma.workout.findFirst({
    where: {
      userId,
      type: { not: 'WALK' },
      date: { gte: localInstant(day, '00:00'), lt: localInstant(next, '00:00') },
    },
    select: { id: true },
  });
  return workout != null;
}

/** A warm-up for a race or test, which the plan never schedules as a session on its own. */
export function isWarmUpOnly(name: string): boolean {
  return /warming[\s-]?up|warm[\s-]?up|opwarm/i.test(name);
}

/**
 * How old a calendar read a quick rebuild will still plan around. The
 * calendar-replan job reads the calendar fresh every 15 minutes and rebuilds
 * the plan itself when anything moved, so a read inside this window is never
 * more than one of its runs behind.
 */
const QUICK_CALENDAR_MAX_AGE_MS = 20 * 60_000;

/**
 * (Re)generates the rolling window for a user with an active plan config.
 *
 * `quick` is for a tap on one day (shuffle, bike/run, that day's hours), where
 * the athlete is waiting on the answer: the library and the calendar are taken
 * as last read rather than fetched from Dropbox and iCloud again. Those two
 * round trips were most of the wait, and the scheduled checks keep both
 * current, so nothing the plan picks from differs. Every other rebuild reads
 * both afresh, as before.
 */
export async function generatePlanWindow(userId: string, { quick = false }: { quick?: boolean } = {}): Promise<void> {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return;
  const days = ROLLING_WINDOW_DAYS;

  const today = utcMidnight(new Date());
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date);
  }

  // The library, the calendar and the days already planned don't depend on
  // each other, so they are read side by side rather than one after another.
  const readLibrary = quick ? cachedWorkoutLibrary : fetchWorkoutLibrary;
  const [fullLibrary, existingRows, slots, trainedToday] = await Promise.all([
    readLibrary(userId).catch(() => [] as ParsedWorkoutFile[]),
    // A day's own one-off availableHoursOverride/disciplineOverride (see
    // setDayAvailability/setDayDiscipline) or manualOverride flag (see
    // swapPlannedDays) survives regeneration — read whatever's already on each
    // row before rebuilding the window around it.
    prisma.plannedDay.findMany({
      where: { userId, date: { in: dates } },
      select: {
        date: true,
        isRestDay: true,
        trainingStress: true,
        sourcePath: true,
        name: true,
        manualOverride: true,
        availableHoursOverride: true,
        disciplineOverride: true,
        shuffle: true,
        discipline: true,
        durationMin: true,
        category: true,
        templateId: true,
        segments: true,
      },
    }),
    daySlots(userId, dates, config.trainingWindows, quick ? QUICK_CALENDAR_MAX_AGE_MS : undefined),
    hasTrainedOn(userId, today),
  ]);
  const todayRow = existingRows.find((row) => row.date.getTime() === today.getTime());
  const completedToday = trainedToday && todayRow ? todayRow : null;

  // Race-day warm-ups stay in the library for picking by hand, but they are
  // preparation for an event, not a day's training. Left in, a 20-minute
  // "Race-/test warming-up" was the closest fit for every short day (a
  // recovery week halves the standing hours) and came back day after day.
  const library = fullLibrary.filter((w) => !isWarmUpOnly(w.name));

  const manualOverrides = new Map<number, ManualOverrideRow>();
  const hourOverrides = new Map<number, number>();
  const disciplineOverrides = new Map<number, PlannedDiscipline>();
  const shuffles = new Map<number, number>();
  for (const row of existingRows) {
    if (row.manualOverride) {
      manualOverrides.set(row.date.getTime(), {
        isRestDay: row.isRestDay,
        trainingStress: row.trainingStress,
        sourcePath: row.sourcePath,
        name: row.name,
      });
    }
    if (row.availableHoursOverride != null) hourOverrides.set(row.date.getTime(), row.availableHoursOverride);
    if (row.disciplineOverride != null) disciplineOverrides.set(row.date.getTime(), row.disciplineOverride);
    if (row.shuffle > 0) shuffles.set(row.date.getTime(), row.shuffle);
  }

  const generatedDays = await runProjection(
    userId,
    dates,
    config,
    library,
    hourOverrides,
    manualOverrides,
    disciplineOverrides,
    slots,
    shuffles,
    completedToday,
  );
  // Each day is its own row, so the writes go out together rather than as
  // fourteen round trips to the database one after another.
  await Promise.all(
    generatedDays
      .filter((generated) => !generated.skipUpsert)
      .map((generated) =>
        upsertPlannedDay(
          userId,
          generated,
          hourOverrides.get(generated.date.getTime()),
          disciplineOverrides.get(generated.date.getTime()),
        ),
      ),
  );
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
    templateId: row.templateId,
    confidence: row.confidence,
    confidenceNote: row.confidenceNote,
    // A time picked for the other day's calendar means nothing on this one.
    plannedStart: null,
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
  await generatePlanWindow(userId, { quick: true });

  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
}

/**
 * A one-off "make this a run instead" (or back to bike) override for any day
 * already in the rolling window — the "Switch to run" action on the
 * Suggested Training card. The algorithm still picks which specific workout
 * (respecting current fitness/readiness and any typed goal), just
 * constrained to this discipline. Pass `discipline: null` to clear the
 * override and hand the day's discipline back to the goal/schedule.
 */
export async function setDayDiscipline(userId: string, date: Date, discipline: PlannedDiscipline | null) {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return null;

  await ensureWindowGenerated(userId);

  const day = utcMidnight(date);
  const today = utcMidnight(new Date());
  if (day < today) return null;

  const existing = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
  if (!existing) return null;

  await prisma.plannedDay.update({ where: { id: existing.id }, data: { disciplineOverride: discipline } });
  await generatePlanWindow(userId, { quick: true });

  return prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
}

/**
 * "Shuffle" on the Suggested Training card: a different workout for one day,
 * of the same type and fitted to the same time. The count is kept on the row,
 * so later regenerations keep the shuffled pick rather than undoing it. A day
 * the athlete had rearranged by hand goes back to the algorithm, since asking
 * for something else is asking the algorithm to choose.
 */
export async function setDayShuffle(userId: string, date: Date) {
  const config = await prisma.trainingPlanConfig.findUnique({ where: { userId } });
  if (!config) return null;

  await ensureWindowGenerated(userId);

  const day = utcMidnight(date);
  const today = utcMidnight(new Date());
  if (day < today) return null;

  const existing = await prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } });
  if (!existing) return null;

  await prisma.plannedDay.update({
    where: { id: existing.id },
    data: { shuffle: { increment: 1 }, manualOverride: false },
  });
  await generatePlanWindow(userId, { quick: true });

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

/**
 * Bump this whenever a change to how the plan picks sessions should reach
 * plans that are already built. Plans built under an older version are rebuilt
 * once, the next time the server starts; nothing else ever reads it.
 */
export const PLAN_LOGIC_VERSION = 6;

/** Rebuilds only the plans built under older rules, then marks them current. */
export async function rebuildOutdatedPlans(): Promise<void> {
  const outdated = await prisma.trainingPlanConfig
    .findMany({ where: { planLogicVersion: { lt: PLAN_LOGIC_VERSION } }, select: { userId: true } })
    .catch((err) => {
      console.error('[training-plan] could not check for outdated plans:', err);
      return [];
    });
  for (const { userId } of outdated) {
    try {
      await generatePlanWindow(userId);
      await prisma.trainingPlanConfig.update({ where: { userId }, data: { planLogicVersion: PLAN_LOGIC_VERSION } });
      console.log(`[training-plan] rebuilt plan for user ${userId} under plan rules v${PLAN_LOGIC_VERSION}`);
    } catch (err) {
      console.error(`[training-plan] failed to rebuild plan for user ${userId}:`, err);
    }
  }
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
