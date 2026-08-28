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
  role?: 'warmup' | 'cooldown';
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
