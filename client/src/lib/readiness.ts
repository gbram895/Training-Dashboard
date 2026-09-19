// A composite 0-100 "readiness" score for the Dashboard hero ring — nothing
// server-side computes a single number today, this blends three signals
// that already exist (HRV vs its own 7-day baseline, last night's sleep vs
// an 8h target, and TSB/form) into one. The weights and bands are a
// reasonable starting heuristic, not a validated formula — easy to retune
// once there's a sense of how it tracks against how a workout actually felt.
const SLEEP_TARGET_HOURS = 8;

function hrvScore(today: number | null, baseline: number | null): number | null {
  if (today == null || baseline == null || baseline <= 0) return null;
  const ratio = today / baseline;
  return Math.max(0, Math.min(100, ratio * 100));
}

function sleepScore(hours: number | null): number | null {
  if (hours == null) return null;
  return Math.max(0, Math.min(100, (hours / SLEEP_TARGET_HOURS) * 100));
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
  tsb: number | null;
}): number | null {
  const parts: { score: number; weight: number }[] = [];
  const hrv = hrvScore(inputs.todayHrv, inputs.hrvBaseline);
  const sleep = sleepScore(inputs.sleepHours);
  const tsb = tsbScore(inputs.tsb);
  if (hrv != null) parts.push({ score: hrv, weight: 0.35 });
  if (sleep != null) parts.push({ score: sleep, weight: 0.25 });
  if (tsb != null) parts.push({ score: tsb, weight: 0.4 });

  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight;
  return Math.round(weighted);
}
