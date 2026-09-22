import { prisma } from './prisma.js';
import { computeHrZoneMinutesFromOffsets, type HrZoneMinutes, type HrZoneThresholds } from './appleHealth.js';

interface PowerSample {
  offsetSec: number;
  powerWatts: number | null;
}

// Total mechanical work done, in kilojoules — the integral of power over time.
// Skips gaps longer than 30s (paused recording) so a stopped ride doesn't get
// credited with phantom work for the time it sat idle.
export function computeKilojoules(samples: PowerSample[]): number | null {
  const withPower = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (withPower.length < 2) return null;

  let joules = 0;
  for (let i = 1; i < withPower.length; i++) {
    const dt = withPower[i].offsetSec - withPower[i - 1].offsetSec;
    if (dt <= 0 || dt > 30) continue;
    joules += withPower[i].powerWatts * dt;
  }
  return joules > 0 ? joules / 1000 : null;
}

export function computeAvgPower(samples: PowerSample[]): number | null {
  const powers = samples.map((s) => s.powerWatts).filter((p): p is number => p != null);
  if (powers.length === 0) return null;
  return powers.reduce((a, b) => a + b, 0) / powers.length;
}

// Coggan's normalized power: 30-sample rolling average -> 4th-power mean -> 4th
// root. Weights sustained hard efforts more than a plain average would, which is
// the point — 200W steady and 400W/0W intervals average the same but tax you very
// differently. Assumes ~1 sample/sec, which is what Garmin and Strava both stream at.
export function computeNormalizedPower(samples: PowerSample[]): number | null {
  const withPower = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (withPower.length < 30) return null;

  const window = 30;
  const rolling: number[] = [];
  const queue: number[] = [];
  let sum = 0;
  for (const { powerWatts } of withPower) {
    queue.push(powerWatts);
    sum += powerWatts;
    if (queue.length > window) sum -= queue.shift()!;
    rolling.push(sum / queue.length);
  }

  const avgFourthPower = rolling.reduce((acc, p) => acc + p ** 4, 0) / rolling.length;
  return avgFourthPower ** 0.25;
}

// TSS scales duration by how hard normalized power was relative to FTP.
export function computeRideTss(samples: PowerSample[], ftpWatts: number): number | null {
  if (!ftpWatts) return null;
  const normalizedPower = computeNormalizedPower(samples);
  if (normalizedPower == null) return null;

  const withPower = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  const intensityFactor = normalizedPower / ftpWatts;
  const durationSec = withPower[withPower.length - 1].offsetSec - withPower[0].offsetSec;
  if (durationSec <= 0) return null;

  return ((durationSec * normalizedPower * intensityFactor) / (ftpWatts * 3600)) * 100;
}

// Pace-based TSS (the running equivalent of the Ride formula above), derived
// from the average pace over the whole activity rather than a sample stream —
// so this works even for workouts with no per-second data at all.
export function computeRunTss(durationMin: number, distanceKm: number, thresholdPaceSecPerKm: number): number | null {
  if (!distanceKm || !thresholdPaceSecPerKm || !durationMin) return null;
  const avgPaceSecPerKm = (durationMin * 60) / distanceKm;
  const intensityFactor = thresholdPaceSecPerKm / avgPaceSecPerKm;
  const durationSec = durationMin * 60;
  return ((durationSec * intensityFactor ** 2) / 3600) * 100;
}

// Representative intensity factor for each heart-rate zone — the midpoint of
// what that zone means as a fraction of threshold. Used to turn time-in-zone
// into a training-stress number for everything power and pace can't measure:
// badminton, hikes, swims, strength, and any ride or run whose stream came
// through without power or distance.
export const ZONE_INTENSITY: Record<keyof HrZoneMinutes, number> = {
  z1: 0.55,
  z2: 0.7,
  z3: 0.83,
  z4: 0.94,
  z5: 1.1,
};

// An HR trace that only covers a fraction of the session (a watch that dropped
// out, a strap put on late) would otherwise report a session as far easier than
// it was. Below this share of the session's own duration, we'd rather have no
// number than a misleading one.
const MIN_HR_COVERAGE = 0.6;

/**
 * Time-in-zone training stress — the same duration x intensity^2 integral the
 * power and pace formulas use, evaluated per zone rather than per sample. Less
 * precise than either (a zone is a band, not a number), which is why it's the
 * last resort in the chain and why the source is recorded alongside the value.
 */
export function computeHrTss(zones: HrZoneMinutes | null, durationMin: number): number | null {
  if (!zones) return null;
  const totalMin = zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
  if (totalMin <= 0) return null;
  if (durationMin > 0 && totalMin < durationMin * MIN_HR_COVERAGE) return null;

  let weightedMinutes = 0;
  for (const key of Object.keys(ZONE_INTENSITY) as (keyof HrZoneMinutes)[]) {
    weightedMinutes += zones[key] * ZONE_INTENSITY[key] ** 2;
  }
  return (weightedMinutes / 60) * 100;
}

type StoredZones = {
  hrZone1Min: number | null;
  hrZone2Min: number | null;
  hrZone3Min: number | null;
  hrZone4Min: number | null;
  hrZone5Min: number | null;
};

function storedZoneMinutes(workout: StoredZones): HrZoneMinutes | null {
  const values = [workout.hrZone1Min, workout.hrZone2Min, workout.hrZone3Min, workout.hrZone4Min, workout.hrZone5Min];
  if (values.every((v) => v == null)) return null;
  return {
    z1: workout.hrZone1Min ?? 0,
    z2: workout.hrZone2Min ?? 0,
    z3: workout.hrZone3Min ?? 0,
    z4: workout.hrZone4Min ?? 0,
    z5: workout.hrZone5Min ?? 0,
  };
}

interface AthleteThresholds {
  ftpWatts: number;
  thresholdPaceSecPerKm: number;
  hrZone1Max: number;
  hrZone2Max: number;
  hrZone3Max: number;
  hrZone4Max: number;
}

const THRESHOLD_SELECT = {
  ftpWatts: true,
  thresholdPaceSecPerKm: true,
  hrZone1Max: true,
  hrZone2Max: true,
  hrZone3Max: true,
  hrZone4Max: true,
} as const;

/** Recomputes and persists kilojoules, TSS and its source for a workout from its current samples and the user's current thresholds. */
export async function recomputeTrainingLoad(workoutId: string): Promise<void> {
  const workout = await prisma.workout.findUnique({ where: { id: workoutId }, include: { samples: true } });
  if (!workout) return;

  const user = await prisma.user.findUnique({ where: { id: workout.userId }, select: THRESHOLD_SELECT });
  if (!user) return;

  await recomputeOne(workout, workout.samples, user);
}

type LoadInputs = {
  id: string;
  type: string;
  durationMin: number;
  distanceKm: number | null;
} & StoredZones;

type LoadSample = { offsetSec: number; heartRate: number | null; powerWatts: number | null };

async function recomputeOne(workout: LoadInputs, samples: LoadSample[], user: AthleteThresholds): Promise<void> {
  let kilojoules: number | null = null;
  let avgPowerWatts: number | null = null;
  let normalizedPowerWatts: number | null = null;

  if (workout.type === 'RIDE') {
    kilojoules = computeKilojoules(samples);
    avgPowerWatts = computeAvgPower(samples);
    normalizedPowerWatts = computeNormalizedPower(samples);
  }

  // Zone minutes are recomputed from the raw samples whenever we still have
  // them, rather than trusted as stored — the stored values were bucketed with
  // whatever thresholds were set at import time, so a zone recalibration would
  // otherwise leave every older workout filed under the old boundaries.
  const thresholds: HrZoneThresholds = {
    z1Max: user.hrZone1Max,
    z2Max: user.hrZone2Max,
    z3Max: user.hrZone3Max,
    z4Max: user.hrZone4Max,
  };
  const fromSamples = computeHrZoneMinutesFromOffsets(samples, workout.durationMin * 60, thresholds);
  const zones = fromSamples ?? storedZoneMinutes(workout);

  // Most precise source wins: per-second power, then average pace, then
  // time-in-zone. Each step only runs if the one above it had nothing to
  // work with, so a ride without a power meter still gets a load number.
  let tss: number | null = null;
  let tssSource: 'POWER' | 'PACE' | 'HR' | null = null;

  if (workout.type === 'RIDE') {
    tss = computeRideTss(samples, user.ftpWatts);
    if (tss != null) tssSource = 'POWER';
  }
  if (tss == null && workout.type === 'RUN') {
    tss = computeRunTss(workout.durationMin, workout.distanceKm ?? 0, user.thresholdPaceSecPerKm);
    if (tss != null) tssSource = 'PACE';
  }
  if (tss == null) {
    tss = computeHrTss(zones, workout.durationMin);
    if (tss != null) tssSource = 'HR';
  }

  await prisma.workout.update({
    where: { id: workout.id },
    data: {
      kilojoules,
      tss,
      tssSource,
      avgPowerWatts,
      normalizedPowerWatts,
      ...(fromSamples
        ? {
            hrZone1Min: fromSamples.z1,
            hrZone2Min: fromSamples.z2,
            hrZone3Min: fromSamples.z3,
            hrZone4Min: fromSamples.z4,
            hrZone5Min: fromSamples.z5,
          }
        : {}),
    },
  });
}

/**
 * Backfills training load for every workout a user has. Runs over all types,
 * not just Ride/Run — the HR fallback means a badminton session or a hike now
 * carries load too, and a threshold or zone recalibration changes every
 * number in the athlete's history, not just the recent ones.
 *
 * Reads the athlete's thresholds once rather than per workout, and pulls each
 * workout's samples in its own query rather than joining them all at once:
 * a season of per-second data is hundreds of thousands of rows, and this runs
 * against a free-tier Postgres.
 */
export async function recomputeAllTrainingLoad(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: THRESHOLD_SELECT });
  if (!user) return 0;

  const workouts = await prisma.workout.findMany({
    where: { userId },
    select: {
      id: true,
      type: true,
      durationMin: true,
      distanceKm: true,
      hrZone1Min: true,
      hrZone2Min: true,
      hrZone3Min: true,
      hrZone4Min: true,
      hrZone5Min: true,
    },
  });

  for (const workout of workouts) {
    const samples = await prisma.workoutSample.findMany({
      where: { workoutId: workout.id },
      select: { offsetSec: true, heartRate: true, powerWatts: true },
      orderBy: { offsetSec: 'asc' },
    });
    await recomputeOne(workout, samples, user);
  }
  return workouts.length;
}
