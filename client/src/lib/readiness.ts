// A composite 0-100 "readiness" score for the Dashboard hero ring — nothing
// server-side computes a single number today, this blends three signals
// that already exist (HRV vs its own 7-day baseline, last night's sleep, and
// TSB/form) into one. The weights and bands are a reasonable starting
// heuristic, not a validated formula — easy to retune once there's a sense of
// how it tracks against how a workout actually felt.
const SLEEP_TARGET_HOURS = 8;

/**
 * How much of the sleep component is length and how much is what the night
 * was made of. Length still leads — eight broken hours beat five good ones —
 * but a full night spent almost entirely in light sleep is not the same
 * recovery as a full night with a normal amount of deep sleep and REM, and
 * before the stage breakdown was imported the score could not tell them
 * apart. Nights with no stage detail score on length alone, exactly as
 * before, so this changes nothing for a night an iPhone recorded.
 */
const SLEEP_QUALITY_WEIGHT = 0.3;

function hrvScore(today: number | null, baseline: number | null): number | null {
  if (today == null || baseline == null || baseline <= 0) return null;
  const ratio = today / baseline;
  return Math.max(0, Math.min(100, ratio * 100));
}

function sleepScore(hours: number | null, quality: number | null): number | null {
  if (hours == null) return null;
  const duration = Math.max(0, Math.min(100, (hours / SLEEP_TARGET_HOURS) * 100));
  if (quality == null) return duration;
  return duration * (1 - SLEEP_QUALITY_WEIGHT) + quality * SLEEP_QUALITY_WEIGHT;
}

function tsbScore(tsb: number | null): number | null {
  if (tsb == null) return null;
  // TSB of 0 (balanced) -> 50; +16 (fresh) -> 100; -16 (very fatigued) -> 0.
  return Math.max(0, Math.min(100, 50 + tsb * 3.125));
}

export function computeReadiness(inputs: {
  todayHrv: number | null;
  hrvBaseline: number | null;
  sleepHours: number | null;
  /** 0-100 from the night's stage breakdown; null when it has none. */
  sleepQuality?: number | null;
  tsb: number | null;
}): number | null {
  const parts: { score: number; weight: number }[] = [];
  const hrv = hrvScore(inputs.todayHrv, inputs.hrvBaseline);
  const sleep = sleepScore(inputs.sleepHours, inputs.sleepQuality ?? null);
  const tsb = tsbScore(inputs.tsb);
  if (hrv != null) parts.push({ score: hrv, weight: 0.35 });
  if (sleep != null) parts.push({ score: sleep, weight: 0.25 });
  if (tsb != null) parts.push({ score: tsb, weight: 0.4 });

  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight;
  return Math.round(weighted);
}
