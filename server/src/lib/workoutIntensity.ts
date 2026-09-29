/**
 * Estimates a 1-5 intensity and training-stress rating for a structured
 * workout (.fit / .zwo) from its planned power/pace targets, since neither
 * format carries a subjective rating the way a hand-typed workout note does.
 *
 * Each segment's `intensityFraction` is its target as a fraction of the
 * rider/runner's threshold (1.0 = FTP for bike, or threshold pace for run).
 * Segments with no usable target (open-ended, HR-based, zone-only) are
 * skipped rather than guessed at.
 *
 * The stress score follows the standard "planned TSS" formula used by
 * TrainingPeaks/Zwift for structured workouts:
 *   TSS = sum(duration_sec * intensityFraction^2) / 3600 * 100
 * and is computed over every segment, warm-up/cool-down included, since
 * those still add real load.
 *
 * The intensity rating, on the other hand, is meant to answer "how hard is
 * this session at its core" - a long steady warm-up/cool-down bookending a
 * short, sharp VO2max set shouldn't dilute that down to "easy". So it's the
 * duration-weighted RMS of only the "core" segments: warm-up/cool-down are
 * trimmed from both ends first, either because a segment is explicitly
 * tagged as one (`role`), or - when a source file doesn't tag them at all,
 * as Garmin's own workout exports don't - because it sits at the very start
 * or end and is well below the session's peak effort.
 */

export interface WorkoutSegment {
  durationSec: number;
  intensityFraction?: number;
  intensityLow?: number;
  intensityHigh?: number;
  role?: 'warmup' | 'cooldown';
  /**
   * Which metric the segment was actually prescribed in. Everything downstream
   * reasons in fractions of threshold regardless, but pushing a session back to
   * a watch has to turn the fraction into a real target again — and a rep the
   * source file prescribed as "198bpm" should go back out as 198bpm, not as the
   * pace that fraction happens to correspond to. Absent on sources that carry no
   * metric of their own (a hand-typed workout note), where the discipline decides.
   */
  targetMetric?: 'power' | 'pace' | 'hr';
}

export interface EstimatedIntensity {
  intensity?: number;
  trainingStress?: number;
}

type UsableSegment = WorkoutSegment & { intensityFraction: number };

function coreSegments(usable: UsableSegment[]): UsableSegment[] {
  if (usable.length < 3) return usable;
  const peak = Math.max(...usable.map((s) => s.intensityFraction));
  const isBookend = (s: UsableSegment) =>
    s.role === 'warmup' || s.role === 'cooldown' || (s.role == null && s.intensityFraction < peak * 0.8);

  let start = 0;
  while (start < usable.length - 1 && isBookend(usable[start])) start++;
  let end = usable.length - 1;
  while (end > start && isBookend(usable[end])) end--;

  const core = usable.slice(start, end + 1);
  return core.length > 0 ? core : usable;
}

export function estimateIntensityAndStress(segments: WorkoutSegment[]): EstimatedIntensity {
  const usable = segments.filter(
    (s): s is UsableSegment => s.intensityFraction != null && s.durationSec > 0,
  );
  if (usable.length === 0) return {};

  const totalSec = usable.reduce((sum, s) => sum + s.durationSec, 0);
  const weightedIfSq = usable.reduce((sum, s) => sum + s.durationSec * s.intensityFraction ** 2, 0);
  const trainingStressScore = (weightedIfSq / 3600) * 100;

  const core = coreSegments(usable);
  const coreTotalSec = core.reduce((sum, s) => sum + s.durationSec, 0);
  const coreWeightedIfSq = core.reduce((sum, s) => sum + s.durationSec * s.intensityFraction ** 2, 0);
  const avgIntensityFactor = Math.sqrt(coreWeightedIfSq / coreTotalSec);

  return {
    intensity: intensityBucket(avgIntensityFactor),
    trainingStress: stressBucket(trainingStressScore),
  };
}

function intensityBucket(avgIntensityFactor: number): number {
  if (avgIntensityFactor < 0.65) return 1;
  if (avgIntensityFactor < 0.75) return 2;
  if (avgIntensityFactor < 0.85) return 3;
  if (avgIntensityFactor < 0.95) return 4;
  return 5;
}

function stressBucket(tss: number): number {
  if (tss < 40) return 1;
  if (tss < 70) return 2;
  if (tss < 100) return 3;
  if (tss < 140) return 4;
  return 5;
}

/**
 * The rough inverse of stressBucket: a representative TSS for each 1-5 bucket.
 *
 * `trainingStress` on a library workout and on a PlannedDay is one of those
 * buckets, NOT a training-stress score — so anywhere a planned session has to
 * be compared against real, logged load (projecting fitness forward in
 * lib/trainingPlan.ts, the planned-vs-actual totals in lib/weeklyReview.ts) it
 * has to come back through here first. It's an estimate: precise TSS only
 * exists once a workout has actually been done.
 */
export function estimatedTssForBucket(bucket: number | null | undefined): number {
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

/**
 * Labels a workout by the hardest zone its main effort actually reaches -
 * the same way a coach would ("this is a VO2max session"), not by its
 * whole-session average, which a brief peak wouldn't move much.
 *
 * That's the hardest band with at least BAND_MIN_TOTAL_SEC of work at or
 * above it, counting only segments of 20s or longer, so a few surges inside
 * a sweet spot ride or one attack after a threshold block doesn't make the
 * whole session VO2max. Sessions that are nothing but short hard efforts
 * (sprints, 3x 1 min) take their peak instead, and sources with no segment
 * data (a hand-typed workout note) fall back to the 1-5 intensity score.
 */
export type WorkoutCategory = 'ENDURANCE' | 'TEMPO' | 'THRESHOLD' | 'VO2MAX';

/**
 * Easiest to hardest. Several places need to reason about "one step easier" or
 * "everything at or below this", so the order lives with the type rather than
 * being re-declared wherever it's needed.
 */
export const CATEGORY_ORDER: WorkoutCategory[] = ['ENDURANCE', 'TEMPO', 'THRESHOLD', 'VO2MAX'];

const SUSTAINED_EFFORT_MIN_SEC = 20;

/**
 * How much time a session has to spend at or above a band before it's labelled
 * by it. Four minutes is about the smallest set still called a VO2max session
 * (eight 30-30s), and more than the accelerations JOIN drops into its sweet
 * spot rides or the one attack at the end of a threshold block.
 */
const BAND_MIN_TOTAL_SEC = 4 * 60;

/** See classifyWorkoutCategory: how much VO2max time, relative to threshold time, makes a VO2max session. */
const VO2MAX_MIN_SHARE_OF_THRESHOLD = 0.5;

/**
 * The intensity a segment is banded on. For power and pace that's the middle of
 * its range: JOIN writes every "@95%" step as a 90-100% window, so the top of
 * the window is five points above what was actually asked for, and banding on
 * it turned every 101-105% threshold rep into "VO2max". Heart rate keeps the
 * top of its range, because a bpm window's midpoint undersells a
 * supra-threshold rep (see normalizeHeartRate in workoutFormats.ts).
 */
function bandingTarget(s: WorkoutSegment & { intensityFraction: number }): number {
  return s.targetMetric === 'hr' ? (s.intensityHigh ?? s.intensityFraction) : s.intensityFraction;
}

/**
 * Which band of effort a single intensity fraction (of threshold) falls in.
 *
 * These are the boundaries classifyWorkoutCategory has always used, pulled out
 * on their own because lib/sessionReview.ts has to bucket a stream of real,
 * ridden efforts the same way the plan buckets the ones it prescribed - if the
 * two ever disagreed, "you did 28 of the 36 minutes asked at threshold" would
 * be comparing two different definitions of threshold.
 */
export function bandForIntensity(fraction: number): WorkoutCategory {
  if (fraction > 1.05) return 'VO2MAX';
  if (fraction > 0.9) return 'THRESHOLD';
  if (fraction > 0.75) return 'TEMPO';
  return 'ENDURANCE';
}

export function classifyWorkoutCategory(
  segments: WorkoutSegment[],
  fallbackIntensity?: number,
): WorkoutCategory | undefined {
  const withTarget = segments.filter(
    (s): s is WorkoutSegment & { intensityFraction: number } => s.intensityFraction != null,
  );
  const sustained = withTarget.filter((s) => s.durationSec >= SUSTAINED_EFFORT_MIN_SEC);
  const counted = sustained.length > 0 ? sustained : withTarget;
  if (counted.length > 0) {
    // The hardest band the session spends real time in, not the hardest single
    // step: one 30-second surge in a tempo ride isn't a VO2max session. When
    // nothing above endurance clears that floor, the short hard efforts ARE the
    // session (3x 1 min kracht, sprint pyramids), so the peak decides instead.
    const secAtOrAbove = new Map<WorkoutCategory, number>();
    for (const s of counted) {
      const idx = CATEGORY_ORDER.indexOf(bandForIntensity(bandingTarget(s)));
      for (const c of CATEGORY_ORDER.slice(0, idx + 1)) secAtOrAbove.set(c, (secAtOrAbove.get(c) ?? 0) + s.durationSec);
    }
    const at = (c: WorkoutCategory) => secAtOrAbove.get(c) ?? 0;
    let reached = [...CATEGORY_ORDER].reverse().find((c) => at(c) >= BAND_MIN_TOTAL_SEC);
    // Over-unders ("Haarspelden": 2 min at 95%, 30s kicks at 106%) touch VO2max
    // but are built around threshold. VO2max has to be at least half as much
    // time as the threshold work around it before it names the session.
    if (reached === 'VO2MAX' && at('VO2MAX') < VO2MAX_MIN_SHARE_OF_THRESHOLD * (at('THRESHOLD') - at('VO2MAX'))) {
      reached = 'THRESHOLD';
    }
    if (reached != null && reached !== 'ENDURANCE') return reached;
    return bandForIntensity(Math.max(...counted.map(bandingTarget)));
  }
  if (fallbackIntensity != null) {
    if (fallbackIntensity >= 5) return 'VO2MAX';
    if (fallbackIntensity === 4) return 'THRESHOLD';
    if (fallbackIntensity === 3) return 'TEMPO';
    return 'ENDURANCE';
  }
  return undefined;
}
