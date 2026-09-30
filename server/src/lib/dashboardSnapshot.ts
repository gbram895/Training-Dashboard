import { prisma } from './prisma.js';
import { computeFitnessSeries } from './fitness.js';

/**
 * The same readiness blend and sleep/HRV/fatigue read as the Dashboard hero
 * ring and stat row — client/src/lib/readiness.ts, client/src/lib/sleep.ts,
 * client/src/lib/hrv.ts, and client/src/components/dashboard/GradientStatRow.tsx.
 * Ported here (rather than shared) because the client and server are separate
 * TS projects with no shared package; keep this in sync if the formula there
 * changes.
 */

const SLEEP_TARGET_HOURS = 8;
const SLEEP_QUALITY_WEIGHT = 0.3;
const RESTORATIVE_REFERENCE = 0.4;
const EFFICIENCY_REFERENCE = 0.95;
const EFFICIENCY_FLOOR = 0.7;

function clamp01to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function sleepQuality(restorative: number | null, efficiency: number | null): number | null {
  const parts: number[] = [];
  if (restorative != null) parts.push(clamp01to100((restorative / RESTORATIVE_REFERENCE) * 100));
  if (efficiency != null) {
    parts.push(clamp01to100(((efficiency - EFFICIENCY_FLOOR) / (EFFICIENCY_REFERENCE - EFFICIENCY_FLOOR)) * 100));
  }
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function hrvScore(today: number | null, baseline: number | null): number | null {
  if (today == null || baseline == null || baseline <= 0) return null;
  return clamp01to100((today / baseline) * 100);
}

function sleepScore(hours: number | null, quality: number | null): number | null {
  if (hours == null) return null;
  const duration = clamp01to100((hours / SLEEP_TARGET_HOURS) * 100);
  if (quality == null) return duration;
  return duration * (1 - SLEEP_QUALITY_WEIGHT) + quality * SLEEP_QUALITY_WEIGHT;
}

function tsbScore(tsb: number | null): number | null {
  if (tsb == null) return null;
  return clamp01to100(50 + tsb * 3.125);
}

function classifyHrv(value: number, baseline: number): 'balanced' | 'unbalanced' | 'low' {
  if (baseline <= 0) return 'balanced';
  const ratio = value / baseline;
  if (ratio >= 0.9) return 'balanced';
  if (ratio >= 0.8) return 'unbalanced';
  return 'low';
}

function fatigueLabel(tsb: number | null): string {
  if (tsb == null) return '—';
  if (tsb > 5) return 'Low';
  if (tsb > -10) return 'Moderate';
  return 'High';
}

function clampBarPct(value: number): number {
  return Math.max(4, Math.min(100, value));
}

export interface DashboardSnapshot {
  readiness: number | null;
  /** `pct` fields are the same 4-100 mini-bar widths GradientStatRow draws, precomputed so any renderer (widget included) doesn't need to re-derive them from raw baselines. */
  sleep: { hours: number | null; note: string; pct: number };
  hrv: { value: number | null; deltaVs7d: number | null; status: 'balanced' | 'unbalanced' | 'low' | null; pct: number };
  fatigue: { label: string; tsb: number | null; pct: number };
}

export async function getDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  // Today plus the 7 days before it — exactly what the Dashboard's own 7-day
  // HRV baseline needs (client's `hrvValues.slice(-8, -1)`).
  const recentDesc = await prisma.dailyHealthSummary.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 8,
  });
  const days = recentDesc.slice().reverse();
  const today = days.length ? days[days.length - 1] : null;

  const hrvValues = days.map((d) => d.avgHrv ?? null);
  const todayHrv = hrvValues.length ? hrvValues[hrvValues.length - 1] : null;
  const hrvBaseline = average(hrvValues.slice(0, -1));
  const hrvDelta = todayHrv != null && hrvBaseline != null ? todayHrv - hrvBaseline : null;
  const hrvStatus = todayHrv != null && hrvBaseline != null ? classifyHrv(todayHrv, hrvBaseline) : null;

  const sleepHours = today?.sleepHours ?? null;
  const hasStages = today?.sleepDeepHours != null || today?.sleepCoreHours != null || today?.sleepRemHours != null;
  const restorative =
    hasStages && sleepHours != null && sleepHours > 0
      ? ((today!.sleepDeepHours ?? 0) + (today!.sleepRemHours ?? 0)) / sleepHours
      : null;
  const efficiency =
    today?.sleepInBedHours != null && today.sleepInBedHours > 0 && sleepHours != null
      ? Math.min(1, sleepHours / today.sleepInBedHours)
      : null;
  const sleepNote =
    sleepHours == null
      ? 'No sleep data'
      : restorative != null
        ? `${Math.round(restorative * 100)}% deep + REM`
        : sleepHours >= 7
          ? 'Good recovery'
          : 'Below target';

  const fitness = await computeFitnessSeries(userId);
  const tsb = fitness.length ? fitness[fitness.length - 1].tsb : null;

  const readiness = (() => {
    const parts: { score: number; weight: number }[] = [];
    const hrv = hrvScore(todayHrv, hrvBaseline);
    const sleep = sleepScore(sleepHours, sleepQuality(restorative, efficiency));
    const tsbPart = tsbScore(tsb);
    if (hrv != null) parts.push({ score: hrv, weight: 0.35 });
    if (sleep != null) parts.push({ score: sleep, weight: 0.25 });
    if (tsbPart != null) parts.push({ score: tsbPart, weight: 0.4 });
    if (parts.length === 0) return null;
    const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
    return Math.round(parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight);
  })();

  const sleepPct = sleepHours != null ? clampBarPct((sleepHours / 8) * 100) : 0;
  const hrvPct = todayHrv != null && hrvBaseline != null ? clampBarPct((todayHrv / hrvBaseline) * 60) : 0;
  const fatiguePct = tsb != null ? clampBarPct(50 - tsb * 2.5) : 0;

  return {
    readiness,
    sleep: { hours: sleepHours, note: sleepNote, pct: sleepPct },
    hrv: { value: todayHrv, deltaVs7d: hrvDelta, status: hrvStatus, pct: hrvPct },
    fatigue: { label: fatigueLabel(tsb), tsb, pct: fatiguePct },
  };
}
