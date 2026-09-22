import { prisma } from './prisma.js';
import { computeHrZoneMinutesFromOffsets, type HrZoneMinutes, type HrZoneThresholds } from './appleHealth.js';
import { ZONE_INTENSITY } from './trainingLoad.js';
import {
  bandForIntensity,
  estimatedTssForBucket,
  CATEGORY_ORDER,
  type WorkoutCategory,
  type WorkoutSegment,
} from './workoutIntensity.js';

/**
 * Did the session that was actually done do the job the planned session was
 * there to do?
 *
 * The app could already say what to train today and, afterwards, what the load
 * of what happened was. Those two never met: nothing compared them, and
 * comparing them on load alone would be worse than not comparing them at all.
 * Training stress is duration x intensity^2, so a lot of easy and a little hard
 * come out the same number — a two-hour steady ride and a 50-minute threshold
 * session both land near 90 TSS and train almost nothing in common. An athlete
 * told "you matched the load" after replacing the second with the first has
 * been congratulated for missing the session.
 *
 * So the judgement here is made in the currency of what the session was FOR:
 *
 *  - A quality session (tempo and up) is a prescription of time in a band.
 *    4 x 8 min at threshold is 32 minutes at threshold; doing 18 of them is 56%
 *    of the session however long the ride was and however high the TSS came out.
 *  - An endurance session is a prescription of duration at restraint. Its
 *    failure mode is the opposite one - riding it too hard - and that failure
 *    is invisible in load terms, because going harder pushes the number UP.
 *
 * Load is still reported, as context and never as the verdict; where the load
 * matched and the session didn't, the review says exactly that.
 *
 * Everything here is derived on request from the PlannedDay row (which past
 * regenerations leave alone - see lib/trainingPlan.ts's generatePlanWindow,
 * which only ever rewrites today forward) and the workout's own samples.
 * Nothing is stored, so there is no history to backfill and a recalibration of
 * FTP or threshold pace re-judges old sessions with the same honesty as new
 * ones.
 */

export type SessionGrade = 'NAILED' | 'SOLID' | 'OFF' | 'MISSED' | 'REST_DAY' | 'UNJUDGED';
export type CheckVerdict = 'GOOD' | 'FAIR' | 'POOR';

/**
 * How the effort was measured, worth surfacing for the same reason TssSource
 * is: per-second power is the truth, pace is close for a run on flat ground,
 * and heart rate lags the effort by 30-60 seconds, which makes short intervals
 * read softer than they were ridden.
 */
export type EffortSource = 'POWER' | 'PACE' | 'HR' | 'NONE';

/**
 * What the comparison could actually be made on.
 *  - TIME_IN_ZONE: the plan carried segments, so the prescription is minutes
 *    in a band and that is what gets checked.
 *  - RESTRAINT: the session was an easy one; the check is that it stayed easy.
 *  - INTENSITY: the plan only carried a difficulty rating (a hand-typed
 *    library file), so the best available check is overall intensity band.
 *  - NONE: no usable effort data, or nothing planned to compare against.
 */
export type ReviewBasis = 'TIME_IN_ZONE' | 'RESTRAINT' | 'INTENSITY' | 'NONE';

export interface SessionCheck {
  key: 'discipline' | 'duration' | 'execution';
  label: string;
  verdict: CheckVerdict;
  /** Rendered for the UI here rather than in the client, so the units stay with the logic that knows them. */
  planned: string | null;
  actual: string | null;
  note: string;
}

export interface BandMinutes {
  band: WorkoutCategory;
  plannedMin: number | null;
  actualMin: number | null;
}

export interface SessionReview {
  date: string; // YYYY-MM-DD
  /** Every workout of the day folded into the judgement — a split session counts once, as one day's training. */
  workoutIds: string[];
  planned: {
    name: string | null;
    discipline: 'BIKE' | 'RUN' | null;
    durationMin: number | null;
    category: WorkoutCategory | null;
    focus: string | null;
    isRestDay: boolean;
    restReason: string | null;
  } | null;
  actual: {
    types: string[];
    durationMin: number;
    tss: number | null;
    rpe: number | null;
  };
  grade: SessionGrade;
  /** 0-100, or null when there was nothing to grade. Secondary to the headline — it is a summary, not the point. */
  score: number | null;
  headline: string;
  checks: SessionCheck[];
  bands: BandMinutes[];
  basis: ReviewBasis;
  effortSource: EffortSource;
  /** Caveats and observations that colour the verdict without being graded: what the load did, what the RPE said, how the effort was measured. */
  notes: string[];
  load: { plannedTss: number | null; actualTss: number | null };
}

// Garmin, Strava and Apple Health all stream at roughly 1 Hz, so a 30-sample
// window is 30 seconds — long enough that a single surge out of a corner isn't
// counted as threshold work, short enough that a genuine 3-minute effort still
// registers in full. Same window and same assumption as normalized power.
const SMOOTHING_SAMPLES = 30;

// A stream that covers only part of the session (a power meter that dropped, a
// strap put on late) would report most of the work as never having happened.
// Same floor, and the same reasoning, as computeHrTss.
const MIN_STREAM_COVERAGE = 0.6;

// Gaps longer than this are a paused recording, not time spent easy.
const MAX_SAMPLE_GAP_SEC = 30;

// Below this, a band's presence in a planned session is incidental — a short
// ramp into an effort, not the effort — and shouldn't decide what the session
// was for.
const MIN_KEY_BAND_MIN = 3;

const BAND_LABEL: Record<WorkoutCategory, string> = {
  ENDURANCE: 'easy',
  TEMPO: 'tempo',
  THRESHOLD: 'threshold',
  VO2MAX: 'VO2max',
};

const DISCIPLINE_LABEL: Record<'BIKE' | 'RUN', string> = { BIKE: 'ride', RUN: 'run' };

const TYPE_LABEL: Record<string, string> = {
  RUN: 'run',
  RIDE: 'ride',
  STRENGTH: 'strength session',
  SWIM: 'swim',
  WALK: 'walk',
  BADMINTON: 'badminton',
  OTHER: 'workout',
};

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type.toLowerCase();
}

function isCategory(value: string | null | undefined): value is WorkoutCategory {
  return value != null && (CATEGORY_ORDER as string[]).includes(value);
}

/** Zone minutes as they were stored at import time, for workouts whose raw samples we never had or no longer keep. */
function storedZoneMinutes(w: {
  hrZone1Min: number | null;
  hrZone2Min: number | null;
  hrZone3Min: number | null;
  hrZone4Min: number | null;
  hrZone5Min: number | null;
}): HrZoneMinutes | null {
  const values = [w.hrZone1Min, w.hrZone2Min, w.hrZone3Min, w.hrZone4Min, w.hrZone5Min];
  if (values.every((v) => v == null)) return null;
  return { z1: w.hrZone1Min ?? 0, z2: w.hrZone2Min ?? 0, z3: w.hrZone3Min ?? 0, z4: w.hrZone4Min ?? 0, z5: w.hrZone5Min ?? 0 };
}

/** Aerobic enough that doing it instead of the planned discipline is at least training, even if it isn't the session. */
const AEROBIC_TYPES = new Set(['RIDE', 'RUN', 'SWIM']);

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mins(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function emptyBands(): Record<WorkoutCategory, number> {
  return { ENDURANCE: 0, TEMPO: 0, THRESHOLD: 0, VO2MAX: 0 };
}

/** Minutes at or above a band — the prescription and the execution are both read this way, so a threshold set ridden at VO2max still counts as having been ridden. */
function minutesAtOrAbove(bands: Record<WorkoutCategory, number>, floor: WorkoutCategory): number {
  const from = CATEGORY_ORDER.indexOf(floor);
  return CATEGORY_ORDER.slice(from).reduce((sum, b) => sum + bands[b], 0);
}

// --- What the plan asked for -----------------------------------------------

function plannedBandMinutes(segments: WorkoutSegment[]): { bands: Record<WorkoutCategory, number>; coveredMin: number } {
  const bands = emptyBands();
  let coveredMin = 0;
  for (const segment of segments) {
    // A segment with no power/pace target (open-ended, "ride to feel", HR-only)
    // is not evidence of anything and is left out rather than guessed at.
    if (segment.intensityFraction == null || !(segment.durationSec > 0)) continue;
    const minutes = segment.durationSec / 60;
    bands[bandForIntensity(segment.intensityFraction)] += minutes;
    coveredMin += minutes;
  }
  return { bands, coveredMin };
}

function parseSegments(raw: unknown): WorkoutSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is WorkoutSegment => !!s && typeof s === 'object' && 'durationSec' in s);
}

// --- What was actually done ------------------------------------------------

interface EffortSlice {
  fraction: number;
  seconds: number;
}

/**
 * Turns a per-second stream into smoothed time-at-intensity.
 *
 * Raw samples are smoothed first because a single second at 400 W is not
 * threshold work — it's a gust, a corner, a gear change — and bucketing raw
 * samples would credit a steady endurance ride with several minutes "at
 * VO2max" it never did.
 */
function effortSlices(
  samples: { offsetSec: number; value: number | null }[],
  threshold: number,
  totalDurationSec: number,
): EffortSlice[] | null {
  if (!(threshold > 0)) return null;
  const usable = samples
    .filter((s): s is { offsetSec: number; value: number } => s.value != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (usable.length < SMOOTHING_SAMPLES) return null;

  const queue: number[] = [];
  let sum = 0;
  const slices: EffortSlice[] = [];
  for (let i = 0; i < usable.length; i++) {
    queue.push(usable[i].value);
    sum += usable[i].value;
    if (queue.length > SMOOTHING_SAMPLES) sum -= queue.shift()!;

    const nextOffset = i + 1 < usable.length ? usable[i + 1].offsetSec : usable[i].offsetSec + 1;
    const gap = nextOffset - usable[i].offsetSec;
    if (gap <= 0) continue;
    slices.push({ fraction: sum / queue.length / threshold, seconds: Math.min(gap, MAX_SAMPLE_GAP_SEC) });
  }

  const covered = slices.reduce((s, x) => s + x.seconds, 0);
  if (totalDurationSec > 0 && covered < totalDurationSec * MIN_STREAM_COVERAGE) return null;
  return slices;
}

function slicesToBands(slices: EffortSlice[]): Record<WorkoutCategory, number> {
  const bands = emptyBands();
  for (const slice of slices) bands[bandForIntensity(slice.fraction)] += slice.seconds / 60;
  return bands;
}

/** Duration-weighted RMS intensity — the same weighting the load formulas use, so "overall it was a tempo ride" means the same thing here as everywhere else. */
function overallFraction(slices: EffortSlice[]): number | null {
  const total = slices.reduce((s, x) => s + x.seconds, 0);
  if (total <= 0) return null;
  return Math.sqrt(slices.reduce((s, x) => s + x.seconds * x.fraction ** 2, 0) / total);
}

function zonesToBands(zones: HrZoneMinutes): Record<WorkoutCategory, number> {
  // Zone midpoints as a fraction of threshold (ZONE_INTENSITY) fall in exactly
  // one band each: z1/z2 easy, z3 tempo, z4 threshold, z5 above it.
  const bands = emptyBands();
  bands.ENDURANCE = zones.z1 + zones.z2;
  bands.TEMPO = zones.z3;
  bands.THRESHOLD = zones.z4;
  bands.VO2MAX = zones.z5;
  return bands;
}

function zonesToOverallFraction(zones: HrZoneMinutes): number | null {
  const total = zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
  if (total <= 0) return null;
  const weighted = (Object.keys(ZONE_INTENSITY) as (keyof HrZoneMinutes)[]).reduce(
    (s, k) => s + zones[k] * ZONE_INTENSITY[k] ** 2,
    0,
  );
  return Math.sqrt(weighted / total);
}

// --- Scoring ---------------------------------------------------------------

function verdictFor(score: number): CheckVerdict {
  if (score >= 0.8) return 'GOOD';
  if (score >= 0.5) return 'FAIR';
  return 'POOR';
}

type ScoredGrade = Exclude<SessionGrade, 'REST_DAY' | 'UNJUDGED'>;

function gradeFor(score: number): ScoredGrade {
  if (score >= 85) return 'NAILED';
  if (score >= 70) return 'SOLID';
  if (score >= 50) return 'OFF';
  return 'MISSED';
}

const HEADLINE: Record<ScoredGrade, string> = {
  NAILED: 'You did the session',
  SOLID: 'Close enough to count',
  OFF: 'Not quite the session',
  MISSED: "That wasn't the session",
};

/**
 * Duration, judged asymmetrically on purpose. Coming up short means part of the
 * prescription didn't happen; going long means it happened and then some, which
 * is a smaller sin — but not a free one, since the extra comes out of the next
 * day's freshness rather than out of nowhere.
 */
function scoreDuration(actualMin: number, plannedMin: number): { score: number; note: string } {
  const ratio = actualMin / plannedMin;
  const delta = Math.round(Math.abs(actualMin - plannedMin));
  if (ratio >= 0.95 && ratio <= 1.15) return { score: 1, note: 'On the time asked for.' };
  if (ratio > 1.15 && ratio <= 1.35)
    return { score: 0.85, note: `${mins(delta)} longer than asked. Fine in itself, but it is borrowed from tomorrow.` };
  if (ratio > 1.35)
    return {
      score: 0.6,
      note: `${mins(delta)} longer than asked — that is a different session, and the cost lands on the days after it.`,
    };
  if (ratio >= 0.85) return { score: 0.8, note: `${mins(delta)} short of the time asked for.` };
  if (ratio >= 0.7) return { score: 0.5, note: `${mins(delta)} short — most of the session, not all of it.` };
  return { score: 0.25, note: `${mins(delta)} short. Only ${Math.round(ratio * 100)}% of the session was done.` };
}

function scoreTimeInZone(
  actualMin: number,
  plannedMin: number,
  band: WorkoutCategory,
): { score: number; note: string } {
  const ratio = actualMin / plannedMin;
  const label = BAND_LABEL[band];
  const did = `${mins(actualMin)} of the ${mins(plannedMin)} at ${label}`;
  if (ratio > 1.6)
    return {
      score: 0.7,
      note: `${mins(actualMin)} at ${label} against the ${mins(plannedMin)} asked for. Overcooking a quality session is its own kind of missing it — it is the next one that pays.`,
    };
  if (ratio >= 0.9) return { score: 1, note: `${did}. That is the session.` };
  if (ratio >= 0.7) return { score: 0.7, note: `${did} — most of the work, a little short of it.` };
  if (ratio >= 0.45) return { score: 0.4, note: `${did}. Under half of it again and this stops being a ${label} session.` };
  return {
    score: 0.15,
    note: `${did}. The session was built around that time at ${label}; it mostly did not happen.`,
  };
}

/**
 * An easy session is failed by going too hard, and that failure is invisible in
 * load terms because riding it harder pushes the load number up. So it gets its
 * own check rather than being folded into "intensity roughly matched".
 */
function scoreRestraint(bands: Record<WorkoutCategory, number>): { score: number; note: string } {
  const total = CATEGORY_ORDER.reduce((s, b) => s + bands[b], 0);
  if (total <= 0) return { score: 1, note: 'Nothing measurable to check restraint against.' };
  const hardMin = minutesAtOrAbove(bands, 'TEMPO');
  const share = hardMin / total;
  if (share <= 0.1) return { score: 1, note: 'Held easy the whole way, which is what an easy day is for.' };
  if (share <= 0.2)
    return { score: 0.75, note: `${mins(hardMin)} crept above easy. Not a problem, but it was not the plan either.` };
  if (share <= 0.35)
    return {
      score: 0.45,
      note: `${mins(hardMin)} — ${Math.round(share * 100)}% of it — was at tempo or harder on a day meant to be easy.`,
    };
  return {
    score: 0.2,
    note: `${Math.round(share * 100)}% of this was at tempo or harder on an easy day. Easy days not being easy is the most reliable way to stop a plan working.`,
  };
}

function scoreIntensityBand(actual: WorkoutCategory, planned: WorkoutCategory): { score: number; note: string } {
  const gap = CATEGORY_ORDER.indexOf(actual) - CATEGORY_ORDER.indexOf(planned);
  if (gap === 0) return { score: 1, note: `Came out as a ${BAND_LABEL[planned]} session, which is what was asked.` };
  const direction = gap > 0 ? 'harder' : 'easier';
  const phrase = `Came out ${BAND_LABEL[actual]} against a ${BAND_LABEL[planned]} session asked for`;
  if (Math.abs(gap) === 1) return { score: 0.6, note: `${phrase} — one band ${direction}.` };
  return { score: 0.3, note: `${phrase} — two bands ${direction}. Different session.` };
}

function scoreDiscipline(types: string[], planned: 'BIKE' | 'RUN'): { score: number; note: string } {
  const wanted = planned === 'RUN' ? 'RUN' : 'RIDE';
  if (types.includes(wanted)) return { score: 1, note: `A ${DISCIPLINE_LABEL[planned]}, as planned.` };
  const did = types.map(typeLabel).join(' and ');
  if (types.some((t) => AEROBIC_TYPES.has(t)))
    return {
      score: 0.4,
      note: `The plan asked for a ${DISCIPLINE_LABEL[planned]}; this was a ${did}. Real training, but not the session that was due.`,
    };
  return {
    score: 0.2,
    note: `The plan asked for a ${DISCIPLINE_LABEL[planned]}; this was a ${did}. It counts toward load and not toward the session.`,
  };
}

// --- The review ------------------------------------------------------------

type SampleRow = { offsetSec: number; heartRate: number | null; speedMps: number | null; powerWatts: number | null };

interface AthleteThresholds {
  ftpWatts: number;
  thresholdPaceSecPerKm: number;
  hrZone1Max: number;
  hrZone2Max: number;
  hrZone3Max: number;
  hrZone4Max: number;
}

/**
 * Measures what was actually done, preferring the most honest source available
 * — the same POWER > PACE > HR chain lib/trainingLoad.ts uses to pick a TSS,
 * for the same reason.
 */
function measureEffort(
  workouts: ReviewWorkout[],
  user: AthleteThresholds,
): { bands: Record<WorkoutCategory, number>; overall: number | null; source: EffortSource } {
  const totals = emptyBands();
  const overallParts: { fraction: number; minutes: number }[] = [];
  const sources = new Set<EffortSource>();

  const hrThresholds: HrZoneThresholds = {
    z1Max: user.hrZone1Max,
    z2Max: user.hrZone2Max,
    z3Max: user.hrZone3Max,
    z4Max: user.hrZone4Max,
  };
  // A run's threshold in the same units its stream arrives in: metres/second.
  const thresholdSpeedMps = user.thresholdPaceSecPerKm > 0 ? 1000 / user.thresholdPaceSecPerKm : 0;

  for (const workout of workouts) {
    const samples = workout.samples;
    const totalSec = workout.durationMin * 60;

    let slices: EffortSlice[] | null = null;
    let source: EffortSource = 'NONE';

    if (workout.type === 'RIDE') {
      slices = effortSlices(
        samples.map((s) => ({ offsetSec: s.offsetSec, value: s.powerWatts })),
        user.ftpWatts,
        totalSec,
      );
      if (slices) source = 'POWER';
    }
    if (!slices && workout.type === 'RUN') {
      slices = effortSlices(
        samples.map((s) => ({ offsetSec: s.offsetSec, value: s.speedMps })),
        thresholdSpeedMps,
        totalSec,
      );
      if (slices) source = 'PACE';
    }

    if (slices) {
      const bands = slicesToBands(slices);
      for (const band of CATEGORY_ORDER) totals[band] += bands[band];
      const fraction = overallFraction(slices);
      if (fraction != null) overallParts.push({ fraction, minutes: workout.durationMin });
      sources.add(source);
      continue;
    }

    // Time in zone is the catch-all, and the reason a badminton night or a
    // swim can be judged at all — bearing in mind heart rate lags the effort,
    // which the caller says out loud rather than quietly pretending otherwise.
    const fromSamples = computeHrZoneMinutesFromOffsets(samples, totalSec, hrThresholds);
    const zones = fromSamples ?? workout.zones;
    const zoneTotal = zones ? zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5 : 0;
    if (zones && zoneTotal > 0 && (totalSec <= 0 || zoneTotal >= workout.durationMin * MIN_STREAM_COVERAGE)) {
      const bands = zonesToBands(zones);
      for (const band of CATEGORY_ORDER) totals[band] += bands[band];
      const fraction = zonesToOverallFraction(zones);
      if (fraction != null) overallParts.push({ fraction, minutes: workout.durationMin });
      sources.add('HR');
    }
  }

  if (sources.size === 0) return { bands: totals, overall: null, source: 'NONE' };

  const totalMinutes = overallParts.reduce((s, p) => s + p.minutes, 0);
  const overall = totalMinutes
    ? Math.sqrt(overallParts.reduce((s, p) => s + p.minutes * p.fraction ** 2, 0) / totalMinutes)
    : null;

  // With a split day measured two different ways, the weakest source is the one
  // the caveat has to be written for.
  const source: EffortSource = sources.has('HR') ? 'HR' : sources.has('PACE') ? 'PACE' : 'POWER';
  return { bands: totals, overall, source };
}

/**
 * Everything one day's judgement needs, with the database left behind.
 *
 * Kept separate from reviewSessionOn deliberately: the scoring is the part
 * worth being sure of, and with the I/O split off it can be exercised against
 * synthetic sessions (see scripts/simulate-session-review.ts) without a
 * Postgres to hand.
 */
export interface ReviewWorkout {
  id: string;
  type: string;
  durationMin: number;
  tss: number | null;
  rpe: number | null;
  samples: SampleRow[];
  /** Zone minutes as stored at import time, used only when the raw samples are gone. */
  zones: HrZoneMinutes | null;
}

export interface ReviewPlannedDay {
  name: string | null;
  discipline: 'BIKE' | 'RUN' | null;
  durationMin: number | null;
  trainingStress: number | null;
  category: string | null;
  focus: string | null;
  isRestDay: boolean;
  restReason: string | null;
  segments: unknown;
}

export interface SessionInputs {
  date: Date;
  planned: ReviewPlannedDay | null;
  workouts: ReviewWorkout[];
  thresholds: AthleteThresholds;
}

/**
 * Judges one day: the planned session against everything logged that day.
 *
 * A day rather than a workout, because a session split into two rides is one
 * session, and because a planned ride plus an unplanned run is a fact about the
 * day that changes what the ride meant.
 */
export function judgeSession({ date, planned, workouts, thresholds }: SessionInputs): SessionReview | null {
  const day = utcMidnight(date);
  if (workouts.length === 0) return null;

  const actualDurationMin = workouts.reduce((s, w) => s + w.durationMin, 0);
  const actualTssValues = workouts.map((w) => w.tss).filter((t): t is number => t != null);
  const rpes = workouts.map((w) => w.rpe).filter((r): r is number => r != null);
  const actual = {
    types: [...new Set(workouts.map((w) => w.type))],
    durationMin: actualDurationMin,
    tss: actualTssValues.length ? Math.round(actualTssValues.reduce((a, b) => a + b, 0)) : null,
    // The hardest rating of the day — an easy spin after intervals shouldn't
    // average the intervals down into feeling comfortable.
    rpe: rpes.length ? Math.max(...rpes) : null,
  };

  const base = {
    date: dateKey(day),
    workoutIds: workouts.map((w) => w.id),
    actual,
    checks: [] as SessionCheck[],
    bands: [] as BandMinutes[],
    notes: [] as string[],
    load: { plannedTss: null as number | null, actualTss: actual.tss },
  };

  if (!planned) {
    return {
      ...base,
      planned: null,
      grade: 'UNJUDGED',
      score: null,
      headline: 'Nothing was planned for this day',
      basis: 'NONE',
      effortSource: 'NONE',
    };
  }

  const plannedSummary = {
    name: planned.name,
    discipline: planned.discipline,
    durationMin: planned.durationMin,
    category: isCategory(planned.category) ? planned.category : null,
    focus: planned.focus,
    isRestDay: planned.isRestDay,
    restReason: planned.restReason,
  };

  // Measure first: even a rest day's verdict depends on how hard the training
  // that replaced it actually was.
  const effort = measureEffort(workouts, thresholds);

  if (planned.isRestDay) {
    const hardMin = minutesAtOrAbove(effort.bands, 'TEMPO');
    const hardShare = actualDurationMin > 0 ? hardMin / actualDurationMin : 0;
    // With no effort data all that is knowable is how long it went on for.
    const easy = effort.source === 'NONE' ? actualDurationMin <= 45 : hardMin < 10 && actualDurationMin <= 90;
    const hardPhrase = hardShare >= 0.8 ? 'nearly all of it' : mins(hardMin);
    return {
      ...base,
      planned: plannedSummary,
      grade: 'REST_DAY',
      score: null,
      headline: easy ? 'A rest day, trained through gently' : 'A rest day, trained through',
      basis: 'NONE',
      effortSource: effort.source,
      notes: [
        planned.restReason ? `The plan had you resting: ${planned.restReason}` : 'The plan had you resting.',
        easy
          ? `${mins(actualDurationMin)}, nothing hard in it. Little harm done, but the rest was there for a reason.`
          : `${mins(actualDurationMin)}${hardMin >= 10 ? `, ${hardPhrase} at tempo or harder` : ''}. That is the recovery this week was counting on, spent.`,
      ],
    };
  }

  // --- Which question is this session actually asking? ---------------------

  const plannedBands = plannedBandMinutes(parseSegments(planned.segments));
  const hasSegmentDetail = plannedBands.coveredMin >= MIN_KEY_BAND_MIN;

  // The plan already recorded what it picked this day to be (PlannedDay.category,
  // set by lib/goalSpecificity.ts); that is the session's own statement of
  // intent and it beats re-deriving one from the file. Without it, the hardest
  // band the file spends real time in is what the session is about.
  const keyBand: WorkoutCategory | null =
    plannedSummary.category ??
    (hasSegmentDetail
      ? ([...CATEGORY_ORDER].reverse().find((b) => plannedBands.bands[b] >= MIN_KEY_BAND_MIN) ?? 'ENDURANCE')
      : null);

  const plannedKeyMin = keyBand ? minutesAtOrAbove(plannedBands.bands, keyBand) : 0;
  const actualKeyMin = keyBand ? minutesAtOrAbove(effort.bands, keyBand) : 0;

  let basis: ReviewBasis = 'NONE';
  if (effort.source !== 'NONE' && keyBand) {
    if (keyBand === 'ENDURANCE') basis = 'RESTRAINT';
    else if (hasSegmentDetail && plannedKeyMin >= MIN_KEY_BAND_MIN) basis = 'TIME_IN_ZONE';
    else if (effort.overall != null) basis = 'INTENSITY';
  }

  // --- The checks ----------------------------------------------------------

  const checks: SessionCheck[] = [];
  const weights: number[] = [];
  const scores: number[] = [];

  if (planned.discipline) {
    const { score, note } = scoreDiscipline(actual.types, planned.discipline);
    checks.push({
      key: 'discipline',
      label: 'Discipline',
      verdict: verdictFor(score),
      planned: DISCIPLINE_LABEL[planned.discipline],
      actual: actual.types.map(typeLabel).join(' + '),
      note,
    });
    weights.push(20);
    scores.push(score);
  }

  if (planned.durationMin) {
    const { score, note } = scoreDuration(actualDurationMin, planned.durationMin);
    checks.push({
      key: 'duration',
      label: 'Duration',
      verdict: verdictFor(score),
      planned: mins(planned.durationMin),
      actual: workouts.length > 1 ? `${mins(actualDurationMin)} across ${workouts.length}` : mins(actualDurationMin),
      note,
    });
    // On an easy day the duration IS most of the prescription, so it carries
    // more of the verdict than it does on an interval session.
    weights.push(basis === 'RESTRAINT' ? 35 : 25);
    scores.push(score);
  }

  if (basis === 'TIME_IN_ZONE' && keyBand) {
    const { score, note } = scoreTimeInZone(actualKeyMin, plannedKeyMin, keyBand);
    checks.push({
      key: 'execution',
      label: `Time at ${BAND_LABEL[keyBand]}`,
      verdict: verdictFor(score),
      planned: mins(plannedKeyMin),
      actual: mins(actualKeyMin),
      note,
    });
    weights.push(55);
    scores.push(score);
  } else if (basis === 'RESTRAINT') {
    const { score, note } = scoreRestraint(effort.bands);
    const measuredTotal = CATEGORY_ORDER.reduce((s, b) => s + effort.bands[b], 0);
    checks.push({
      key: 'execution',
      label: 'Staying easy',
      verdict: verdictFor(score),
      planned: 'easy throughout',
      actual: measuredTotal > 0 ? `${Math.round((effort.bands.ENDURANCE / measuredTotal) * 100)}% easy` : null,
      note,
    });
    weights.push(45);
    scores.push(score);
  } else if (basis === 'INTENSITY' && keyBand && effort.overall != null) {
    const { score, note } = scoreIntensityBand(bandForIntensity(effort.overall), keyBand);
    checks.push({
      key: 'execution',
      label: 'Intensity',
      verdict: verdictFor(score),
      planned: BAND_LABEL[keyBand],
      actual: BAND_LABEL[bandForIntensity(effort.overall)],
      note,
    });
    weights.push(55);
    scores.push(score);
  }

  // --- Notes: what colours the verdict without being it --------------------

  const notes: string[] = [];
  if (planned.focus) notes.push(`What it was for: ${planned.focus}`);

  if (effort.source === 'NONE') {
    notes.push(
      'No power, pace or heart-rate detail came through for this one, so it is judged on duration and discipline alone. That cannot tell you whether the efforts landed.',
    );
  } else if (effort.source === 'HR' && planned.discipline != null) {
    notes.push(
      'Measured from heart rate, which lags the effort by half a minute or so. Short, sharp intervals read softer here than they were done.',
    );
  }

  const plannedTss = planned.trainingStress != null ? estimatedTssForBucket(planned.trainingStress) : null;
  const executionCheck = checks.find((c) => c.key === 'execution');
  if (plannedTss != null && actual.tss != null && plannedTss > 0) {
    const drift = (actual.tss - plannedTss) / plannedTss;
    // The whole reason this is not a TSS comparison: when the load matched and
    // the session did not, saying so plainly is the useful part. Only on a
    // genuine shortfall, though — a session ridden harder than asked also
    // lands near the planned load, and there the honest note is the one about
    // overcooking it, not this one.
    if (Math.abs(drift) <= 0.15 && executionCheck?.verdict === 'POOR') {
      notes.push(
        `The load came out about where the plan expected it (${actual.tss} against roughly ${plannedTss} TSS). That is the trap — the same cost, a different adaptation.`,
      );
    } else if (drift > 0.3) {
      notes.push(
        `Roughly ${Math.round(drift * 100)}% more load than the day was meant to carry (${actual.tss} against roughly ${plannedTss} TSS).`,
      );
    } else if (drift < -0.3) {
      notes.push(
        `Roughly ${Math.round(-drift * 100)}% less load than the day was meant to carry (${actual.tss} against roughly ${plannedTss} TSS).`,
      );
    }
  }

  if (actual.rpe != null && keyBand) {
    if (keyBand === 'ENDURANCE' && actual.rpe >= 7) {
      notes.push(
        `You rated it ${actual.rpe}/10 on a day meant to be steady. Either it was not steady, or there is more fatigue in the legs than the plan assumed.`,
      );
    } else if ((keyBand === 'THRESHOLD' || keyBand === 'VO2MAX') && actual.rpe <= 4) {
      notes.push(
        `Rated ${actual.rpe}/10 for a ${BAND_LABEL[keyBand]} session. Work at that intensity that felt that easy usually was not at that intensity.`,
      );
    }
  }

  // --- Verdict -------------------------------------------------------------

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weighted = totalWeight > 0 ? Math.round((scores.reduce((s, x, i) => s + x * weights[i], 0) / totalWeight) * 100) : null;

  let grade: SessionGrade = weighted == null ? 'UNJUDGED' : gradeFor(weighted);
  let headline = weighted == null ? 'Not enough here to judge' : HEADLINE[gradeFor(weighted)];

  // Duration and discipline alone cannot say a session was done — only that
  // nothing was obviously wrong with its shape. Letting that pass as "you did
  // the session", or putting a number on it, would be exactly the
  // congratulation this whole thing exists to avoid. A bad shape is still
  // worth grading: the wrong sport for half the time asked is a miss whether
  // or not a power meter was running.
  if (basis === 'NONE' && grade === 'NAILED') {
    grade = 'SOLID';
    headline = 'Right shape, no way to check the efforts';
  }
  const score = basis === 'NONE' ? null : weighted;

  const bands: BandMinutes[] = CATEGORY_ORDER.map((band) => ({
    band,
    plannedMin: hasSegmentDetail ? Math.round(plannedBands.bands[band]) : null,
    actualMin: effort.source === 'NONE' ? null : Math.round(effort.bands[band]),
  }));

  return {
    ...base,
    planned: plannedSummary,
    grade,
    score,
    headline,
    checks,
    bands,
    basis,
    effortSource: effort.source,
    notes,
    load: { plannedTss, actualTss: actual.tss },
  };
}

const THRESHOLD_SELECT = {
  ftpWatts: true,
  thresholdPaceSecPerKm: true,
  hrZone1Max: true,
  hrZone2Max: true,
  hrZone3Max: true,
  hrZone4Max: true,
} as const;

/** Loads a day out of the database and judges it. */
export async function reviewSessionOn(userId: string, date: Date): Promise<SessionReview | null> {
  const day = utcMidnight(date);
  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const [planned, workouts, user] = await Promise.all([
    prisma.plannedDay.findUnique({ where: { userId_date: { userId, date: day } } }),
    prisma.workout.findMany({ where: { userId, date: { gte: day, lt: nextDay } }, orderBy: { date: 'asc' } }),
    prisma.user.findUnique({ where: { id: userId }, select: THRESHOLD_SELECT }),
  ]);
  if (!user || workouts.length === 0) return null;

  // One samples query per workout rather than one join across all of them —
  // a day of per-second data is tens of thousands of rows and this runs against
  // a free-tier Postgres. Same reasoning as recomputeAllTrainingLoad.
  const reviewWorkouts: ReviewWorkout[] = await Promise.all(
    workouts.map(async (w) => ({
      id: w.id,
      type: w.type,
      durationMin: w.durationMin,
      tss: w.tss,
      rpe: w.rpe,
      samples: await prisma.workoutSample.findMany({
        where: { workoutId: w.id },
        select: { offsetSec: true, heartRate: true, speedMps: true, powerWatts: true },
        orderBy: { offsetSec: 'asc' },
      }),
      zones: storedZoneMinutes(w),
    })),
  );

  return judgeSession({
    date: day,
    planned: planned
      ? {
          name: planned.name,
          discipline: planned.discipline,
          durationMin: planned.durationMin,
          trainingStress: planned.trainingStress,
          category: planned.category,
          focus: planned.focus,
          isRestDay: planned.isRestDay,
          restReason: planned.restReason,
          segments: planned.segments,
        }
      : null,
    workouts: reviewWorkouts,
    thresholds: user,
  });
}

/** The review for one logged workout — which is the review of the day it was done on. */
export async function reviewSessionForWorkout(userId: string, workoutId: string): Promise<SessionReview | null> {
  const workout = await prisma.workout.findFirst({ where: { id: workoutId, userId }, select: { date: true } });
  if (!workout) return null;
  return reviewSessionOn(userId, workout.date);
}

/**
 * The most recent day worth showing a verdict for, within `days` back.
 *
 * Which days had a plan is settled first, in one cheap query, because judging a
 * day means walking every sample of every workout on it — and this runs on
 * every dashboard load. Without that filter a week with no plan behind it would
 * pull a week of per-second data off a free-tier Postgres to conclude there was
 * nothing to say.
 */
export async function latestSessionReview(userId: string, days = 7): Promise<SessionReview | null> {
  const since = utcMidnight(new Date());
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const [plannedDays, workouts] = await Promise.all([
    prisma.plannedDay.findMany({ where: { userId, date: { gte: since } }, select: { date: true } }),
    prisma.workout.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  ]);

  const plannedDates = new Set(plannedDays.map((p) => dateKey(utcMidnight(p.date))));
  const mostRecent = workouts.find((w) => plannedDates.has(dateKey(utcMidnight(w.date))));
  return mostRecent ? reviewSessionOn(userId, mostRecent.date) : null;
}
