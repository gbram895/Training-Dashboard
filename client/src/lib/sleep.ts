import type { DailyHealthSummary } from '../api/types';

/**
 * Everything the app derives from a night's stage breakdown.
 *
 * The raw numbers come from Apple Health via the importer (see
 * server/src/lib/sleepAnalysis.ts for how a night is put together and why
 * `asleep`/`inBed` can't be used). The scoring here is deliberately the same
 * shape as the server's, because the plan's readiness ceiling and the
 * dashboard's readiness ring have to agree about what a bad night is — see
 * getReadinessModifiers in server/src/lib/trainingPlan.ts.
 */

export type SleepStage = 'deep' | 'core' | 'rem' | 'awake';

export const STAGE_LABEL: Record<SleepStage, string> = {
  deep: 'Deep',
  core: 'Core',
  rem: 'REM',
  awake: 'Awake',
};

export const STAGE_COLOR: Record<SleepStage, string> = {
  deep: 'var(--sleep-deep)',
  core: 'var(--sleep-core)',
  rem: 'var(--sleep-rem)',
  awake: 'var(--sleep-awake)',
};

/** Drawing order, from deepest to awake — how every sleep app stacks them. */
export const STAGE_ORDER: SleepStage[] = ['deep', 'core', 'rem', 'awake'];

export interface SleepNightView {
  date: string;
  totalHours: number;
  stages: Record<SleepStage, number | null>;
  /** Lights-out to getting up. */
  inBedHours: number | null;
  start: string | null;
  end: string | null;
  source: string | null;
  wristTempC: number | null;
  respiratoryRate: number | null;
  /** Deep + REM as a share of time asleep, 0-1. */
  restorativeShare: number | null;
  /** Time asleep as a share of the night, 0-1. */
  efficiency: number | null;
  /** 0-100, or null when the night has no stage detail. */
  quality: number | null;
  hasStages: boolean;
}

export function toSleepNight(day: DailyHealthSummary): SleepNightView | null {
  if (day.sleepHours == null || day.sleepHours <= 0) return null;

  const stages: Record<SleepStage, number | null> = {
    deep: day.sleepDeepHours ?? null,
    core: day.sleepCoreHours ?? null,
    rem: day.sleepRemHours ?? null,
    awake: day.sleepAwakeHours ?? null,
  };
  const hasStages = stages.deep != null || stages.core != null || stages.rem != null;

  const totalHours = day.sleepHours;
  const inBedHours = day.sleepInBedHours ?? null;
  const restorative =
    hasStages && totalHours > 0 ? ((stages.deep ?? 0) + (stages.rem ?? 0)) / totalHours : null;
  const efficiency = inBedHours != null && inBedHours > 0 ? Math.min(1, totalHours / inBedHours) : null;

  return {
    date: day.date,
    totalHours,
    stages,
    inBedHours,
    start: day.sleepStart ?? null,
    end: day.sleepEnd ?? null,
    source: day.sleepSource ?? null,
    wristTempC: day.sleepingWristTempC ?? null,
    respiratoryRate: day.sleepRespiratoryRate ?? null,
    restorativeShare: restorative,
    efficiency,
    quality: sleepQuality(restorative, efficiency),
    hasStages,
  };
}

/**
 * How good a night was, independent of how long it was — 0-100, where 100 is
 * a night as restorative and unbroken as a good one of Bram's own nights.
 *
 * The two reference points are set from his last months of data rather than
 * from a textbook: deep + REM runs a little under 40% of time asleep, and
 * around 96% of the night is spent asleep rather than awake. Both are
 * heuristics, the same caveat the readiness score carries.
 */
const RESTORATIVE_REFERENCE = 0.4;
const EFFICIENCY_REFERENCE = 0.95;
/** Below this, a night is mostly interrupted rather than merely imperfect. */
const EFFICIENCY_FLOOR = 0.7;

export function sleepQuality(restorative: number | null, efficiency: number | null): number | null {
  const parts: number[] = [];
  if (restorative != null) {
    parts.push(clamp((restorative / RESTORATIVE_REFERENCE) * 100));
  }
  if (efficiency != null) {
    // Efficiency bunches up near the top — every unbroken night sits between
    // 0.93 and 0.99 — so a plain ratio would score them all at ~100 and never
    // separate a broken night from a good one. Stretching the range that
    // actually varies is what gives this any discriminating power.
    parts.push(clamp(((efficiency - EFFICIENCY_FLOOR) / (EFFICIENCY_REFERENCE - EFFICIENCY_FLOOR)) * 100));
  }
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** A plain-language read on the night, for the card's one-line verdict. */
export function sleepVerdict(night: SleepNightView): string {
  const { totalHours, quality, restorativeShare: restorative, efficiency } = night;

  if (totalHours < 6) {
    return quality != null && quality >= 70
      ? 'Short, but what you got was solid.'
      : 'A short night, and broken with it.';
  }
  if (quality == null) return 'No stage detail for this night.';
  if (quality >= 80) return 'Long and restorative — a good night.';
  if (efficiency != null && efficiency < 0.85) return 'Long enough, but you were awake a lot of it.';
  if (restorative != null && restorative < 0.3) return 'Long enough, but light — little deep sleep or REM.';
  return 'A reasonable night.';
}

/** Averages a stage across the nights that reported it. Null when none did. */
export function averageStage(nights: SleepNightView[], stage: SleepStage): number | null {
  const values = nights.map((n) => n.stages[stage]).filter((v): v is number => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
