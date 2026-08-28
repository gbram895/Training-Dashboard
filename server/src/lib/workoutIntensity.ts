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
 * and average intensity factor (for the intensity bucket) is the
 * duration-weighted RMS of the same fractions.
 */

export interface WorkoutSegment {
  durationSec: number;
  intensityFraction?: number;
}

export interface EstimatedIntensity {
  intensity?: number;
  trainingStress?: number;
}

export function estimateIntensityAndStress(segments: WorkoutSegment[]): EstimatedIntensity {
  const usable = segments.filter(
    (s): s is WorkoutSegment & { intensityFraction: number } =>
      s.intensityFraction != null && s.durationSec > 0,
  );
  if (usable.length === 0) return {};

  const totalSec = usable.reduce((sum, s) => sum + s.durationSec, 0);
  const weightedIfSq = usable.reduce((sum, s) => sum + s.durationSec * s.intensityFraction ** 2, 0);
  const avgIntensityFactor = Math.sqrt(weightedIfSq / totalSec);
  const trainingStressScore = (weightedIfSq / 3600) * 100;

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
