/**
 * The primitive every "best effort" in the app is built on, plus the bounds
 * that decide when a derived number is an athlete rather than bad data.
 *
 * It lives in its own module because three separate things need it and none of
 * them should depend on the others: the Calibration card reads a 20-minute
 * best to suggest FTP (lib/calibration.ts), the power curve reads nine
 * durations to draw itself (lib/powerCurve.ts), and the goal projections read
 * demonstrated capability (lib/thresholdPotential.ts).
 */

export interface Sample {
  offsetSec: number;
  value: number;
}

/**
 * A pause in recording — a coffee stop, a traffic light with auto-pause on —
 * leaves a hole in the sample stream. Treating the samples either side as
 * adjacent would let a "20 minute" best span a twenty-minute break, so a hole
 * longer than this ends the effort and a new one starts after it.
 *
 * The same 30 seconds computeKilojoules already skips, for the same reason.
 */
export const MAX_GAP_SEC = 30;

/**
 * Outside these, the input was wrong rather than the athlete exceptional, and
 * no suggestion is offered at all.
 *
 * Accepting a suggestion rescales the athlete's entire history, so a number
 * derived from bad data is worse than no number: a confident, one-tap "Use
 * 1:46/km" is exactly how a mistake gets applied. The floor on pace is well
 * inside world-record territory (a 10k world record is about 2:35/km), so
 * anything under it means the data is not someone running.
 */
export const PLAUSIBLE_FTP_WATTS = { min: 40, max: 600 };
export const PLAUSIBLE_PACE_SEC_PER_KM = { min: 150, max: 900 };

/** Splits a stream into runs with no recording gap, so a window can't span a pause. */
function contiguousRuns(samples: Sample[], maxGapSec: number): Sample[][] {
  const sorted = [...samples].sort((a, b) => a.offsetSec - b.offsetSec);
  const runs: Sample[][] = [];
  let run: Sample[] = [];
  for (const s of sorted) {
    if (run.length > 0 && s.offsetSec - run[run.length - 1].offsetSec > maxGapSec) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * How long one sample stands for, taken as the median gap between consecutive
 * samples so an occasional dropout doesn't move it. Assumes a regular stream,
 * which is what Garmin, Strava and Apple Health all produce, and what
 * computeNormalizedPower already assumes.
 */
function sampleIntervalSec(run: Sample[]): number {
  if (run.length < 2) return 1;
  const gaps: number[] = [];
  for (let i = 1; i < run.length; i++) gaps.push(run[i].offsetSec - run[i - 1].offsetSec);
  gaps.sort((a, b) => a - b);
  return Math.max(1, gaps[Math.floor(gaps.length / 2)]);
}

/**
 * Best average value sustained over `windowSec`.
 *
 * A sample stands for the interval that follows it, so N samples of a 1Hz
 * stream cover N seconds even though the elapsed time between the first and
 * the last is N-1. Counting only the elapsed span would quietly ask for a
 * window one sample too long — which is invisible over twenty minutes but
 * turns a best 5-second sprint into a best 6-second one, reading about 15%
 * low. The interval is added back so a window of exactly `windowSec` counts.
 *
 * A window only counts once it actually covers `windowSec`, so a sparse or
 * short stream reports nothing rather than a best taken over too little data.
 */
export function bestRollingAverage(samples: Sample[], windowSec: number, maxGapSec = MAX_GAP_SEC): number | null {
  let best: number | null = null;

  for (const run of contiguousRuns(samples, maxGapSec)) {
    const covered = sampleIntervalSec(run);

    const prefix: number[] = [0];
    for (const s of run) prefix.push(prefix[prefix.length - 1] + s.value);

    let start = 0;
    for (let end = 0; end < run.length; end++) {
      // Shrink from the left while the window is longer than it needs to be, so
      // `start` always sits at the tightest span still covering windowSec.
      while (start < end && run[end].offsetSec - run[start + 1].offsetSec + covered >= windowSec) start++;
      if (run[end].offsetSec - run[start].offsetSec + covered < windowSec) continue;
      const mean = (prefix[end + 1] - prefix[start]) / (end + 1 - start);
      if (best == null || mean > best) best = mean;
    }
  }

  return best;
}
