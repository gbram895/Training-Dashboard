import { WorkoutType } from '@prisma/client';
import { resolveSleepNight, type SleepAnalysisEntry } from './sleepAnalysis.js';

// Metric entries carry different fields depending on the metric: a scalar one
// has `qty`, heart rate has Avg/Min/Max, and sleep_analysis carries a whole
// night's stage breakdown (see sleepAnalysis.ts for that shape).
export interface HealthAutoExportMetricEntry extends Partial<SleepAnalysisEntry> {
  date: string;
  source?: string;
  qty?: number;
  Avg?: number;
  Min?: number;
  Max?: number;
}

export interface HealthAutoExportMetric {
  name: string;
  units: string;
  data: HealthAutoExportMetricEntry[];
}

export interface HeartRateSample {
  date: string;
  Avg?: number;
  Min?: number;
  Max?: number;
}

export interface HealthAutoExportWorkout {
  id?: string;
  name: string;
  start: string;
  end: string;
  duration?: number;
  distance?: { qty: number; units: string };
  activeEnergy?: { qty: number; units: string };
  heartRateData?: HeartRateSample[];
}

export interface HrZoneThresholds {
  z1Max: number;
  z2Max: number;
  z3Max: number;
  z4Max: number;
}

export interface HrZoneMinutes {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export function zoneFor(bpm: number, t: HrZoneThresholds): keyof HrZoneMinutes {
  if (bpm <= t.z1Max) return 'z1';
  if (bpm <= t.z2Max) return 'z2';
  if (bpm <= t.z3Max) return 'z3';
  if (bpm <= t.z4Max) return 'z4';
  return 'z5';
}

export function computeHrZoneMinutes(
  samples: HeartRateSample[] | undefined,
  workoutEnd: string,
  thresholds: HrZoneThresholds,
): HrZoneMinutes | null {
  if (!samples || samples.length === 0) return null;
  const sorted = samples
    .filter((s): s is HeartRateSample & { Avg: number } => s.Avg != null)
    .map((s) => ({ time: new Date(s.date).getTime(), bpm: s.Avg }))
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;

  const endTime = new Date(workoutEnd).getTime();
  const zones: HrZoneMinutes = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const nextTime = i + 1 < sorted.length ? sorted[i + 1].time : endTime;
    const durationMin = Math.max(0, (nextTime - current.time) / 60000);
    zones[zoneFor(current.bpm, thresholds)] += durationMin;
  }

  return zones;
}

// Same bucketing as computeHrZoneMinutes, but for samples timestamped as an
// offset in seconds from activity start (Garmin/Strava per-second streams)
// rather than as absolute dates (Apple Health).
export function computeHrZoneMinutesFromOffsets(
  samples: { offsetSec: number; heartRate?: number | null }[],
  totalDurationSec: number,
  thresholds: HrZoneThresholds,
): HrZoneMinutes | null {
  const sorted = samples
    .filter((s): s is { offsetSec: number; heartRate: number } => s.heartRate != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (sorted.length === 0) return null;

  const zones: HrZoneMinutes = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const nextOffset = i + 1 < sorted.length ? sorted[i + 1].offsetSec : totalDurationSec;
    const durationMin = Math.max(0, (nextOffset - current.offsetSec) / 60);
    zones[zoneFor(current.heartRate, thresholds)] += durationMin;
  }
  return zones;
}

export interface HealthAutoExportFile {
  data: {
    metrics?: HealthAutoExportMetric[];
    workouts?: HealthAutoExportWorkout[];
  };
}

export interface DailyAggregate {
  date: string; // YYYY-MM-DD
  steps?: number;
  distanceKm?: number;
  activeEnergyKcal?: number;
  avgHeartRate?: number;
  restingHeartRate?: number;
  sleepHours?: number;
  sleepDeepHours?: number;
  sleepCoreHours?: number;
  sleepRemHours?: number;
  sleepAwakeHours?: number;
  sleepInBedHours?: number;
  sleepStart?: Date;
  sleepEnd?: Date;
  sleepSource?: string;
  sleepingWristTempC?: number;
  sleepRespiratoryRate?: number;
  exerciseMinutes?: number;
  flightsClimbed?: number;
  vo2Max?: number;
  avgHrv?: number;
  avgBloodOxygen?: number;
}

const KJ_TO_KCAL = 0.239006;

/**
 * Metrics the watch only records while asleep. They are filed with the night
 * rather than with the calendar day their timestamp falls in — see
 * sleepNightDateKey.
 */
const SLEEP_SCOPED_METRICS = new Set(['apple_sleeping_wrist_temperature', 'respiratory_rate']);

/**
 * Apple times a night by the morning it ends: the night of the 20th-21st is
 * filed under the 21st. The measurements taken during that night are not —
 * the wrist temperature for that night is stamped 22:50 on the 20th, and the
 * breathing-rate readings start before midnight and carry on past it.
 *
 * Keyed on their own timestamps they scatter across two rows, half of them a
 * day away from the night they describe, which is why the 21st had a stage
 * breakdown but no temperature while the 20th had a temperature belonging to
 * the following night. Anything recorded in the evening belongs to the night
 * that ends the next morning.
 */
const EVENING_ROLLS_OVER_FROM_HOUR = 18;

export function sleepNightDateKey(timestamp: string): string {
  const day = timestamp.slice(0, 10);
  // Local hour, straight off the "YYYY-MM-DD HH:MM:SS ±HHMM" string. Read as
  // written on purpose: the day key is the local calendar day everywhere else
  // in this file, so the hour has to be the local one too.
  const hour = Number(timestamp.slice(11, 13));
  if (!Number.isFinite(hour) || hour < EVENING_ROLLS_OVER_FROM_HOUR) return day;
  const next = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return day;
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

interface Accumulator {
  steps: number;
  distanceKm: number;
  activeEnergyKj: number;
  heartRateSum: number;
  heartRateCount: number;
  restingHeartRateSum: number;
  restingHeartRateCount: number;
  // Collected rather than summed: resolving a night needs every entry for the
  // date at once, so that two devices reporting the same night are reconciled
  // instead of added together. See resolveSleepNight.
  sleepEntries: SleepAnalysisEntry[];
  sleepUnits: string;
  sleepingWristTempSum: number;
  sleepingWristTempCount: number;
  sleepRespiratoryRateSum: number;
  sleepRespiratoryRateCount: number;
  exerciseMinutes: number;
  flightsClimbed: number;
  vo2MaxSum: number;
  vo2MaxCount: number;
  hrvSum: number;
  hrvCount: number;
  bloodOxygenSum: number;
  bloodOxygenCount: number;
}

function newAccumulator(): Accumulator {
  return {
    steps: 0,
    distanceKm: 0,
    activeEnergyKj: 0,
    heartRateSum: 0,
    heartRateCount: 0,
    restingHeartRateSum: 0,
    restingHeartRateCount: 0,
    sleepEntries: [],
    sleepUnits: 'hr',
    sleepingWristTempSum: 0,
    sleepingWristTempCount: 0,
    sleepRespiratoryRateSum: 0,
    sleepRespiratoryRateCount: 0,
    exerciseMinutes: 0,
    flightsClimbed: 0,
    vo2MaxSum: 0,
    vo2MaxCount: 0,
    hrvSum: 0,
    hrvCount: 0,
    bloodOxygenSum: 0,
    bloodOxygenCount: 0,
  };
}

export function aggregateHealthExports(files: HealthAutoExportFile[]): DailyAggregate[] {
  const byDate = new Map<string, Accumulator>();

  for (const file of files) {
    for (const metric of file.data.metrics ?? []) {
      for (const entry of metric.data) {
        const dateKey = SLEEP_SCOPED_METRICS.has(metric.name)
          ? sleepNightDateKey(entry.date)
          : entry.date.slice(0, 10);
        if (!byDate.has(dateKey)) byDate.set(dateKey, newAccumulator());
        const acc = byDate.get(dateKey)!;

        switch (metric.name) {
          case 'step_count':
            acc.steps += entry.qty ?? 0;
            break;
          case 'walking_running_distance':
            acc.distanceKm += entry.qty ?? 0;
            break;
          case 'active_energy':
            acc.activeEnergyKj += entry.qty ?? 0;
            break;
          case 'heart_rate':
            if (entry.Avg != null) {
              acc.heartRateSum += entry.Avg;
              acc.heartRateCount += 1;
            }
            break;
          case 'resting_heart_rate':
            if (entry.qty != null) {
              acc.restingHeartRateSum += entry.qty;
              acc.restingHeartRateCount += 1;
            }
            break;
          case 'sleep_analysis':
            acc.sleepEntries.push(entry as SleepAnalysisEntry);
            acc.sleepUnits = metric.units;
            break;
          case 'apple_sleeping_wrist_temperature':
            if (entry.qty != null) {
              acc.sleepingWristTempSum += entry.qty;
              acc.sleepingWristTempCount += 1;
            }
            break;
          // Apple measures breathing rate only during sleep, many times a
          // night; the average across the night is the number worth keeping.
          case 'respiratory_rate':
            if (entry.qty != null) {
              acc.sleepRespiratoryRateSum += entry.qty;
              acc.sleepRespiratoryRateCount += 1;
            }
            break;
          case 'apple_exercise_time':
            acc.exerciseMinutes += entry.qty ?? 0;
            break;
          case 'flights_climbed':
            acc.flightsClimbed += entry.qty ?? 0;
            break;
          case 'vo2_max':
            if (entry.qty != null) {
              acc.vo2MaxSum += entry.qty;
              acc.vo2MaxCount += 1;
            }
            break;
          case 'heart_rate_variability':
            if (entry.qty != null) {
              acc.hrvSum += entry.qty;
              acc.hrvCount += 1;
            }
            break;
          case 'blood_oxygen_saturation':
            if (entry.qty != null) {
              acc.bloodOxygenSum += entry.qty;
              acc.bloodOxygenCount += 1;
            }
            break;
        }
      }
    }
  }

  return Array.from(byDate.entries())
    .map(([date, acc]) => {
      const night = resolveSleepNight(acc.sleepEntries, acc.sleepUnits);
      return {
        date,
        steps: acc.steps || undefined,
        distanceKm: acc.distanceKm || undefined,
        activeEnergyKcal: acc.activeEnergyKj ? acc.activeEnergyKj * KJ_TO_KCAL : undefined,
        avgHeartRate: acc.heartRateCount ? acc.heartRateSum / acc.heartRateCount : undefined,
        restingHeartRate: acc.restingHeartRateCount
          ? acc.restingHeartRateSum / acc.restingHeartRateCount
          : undefined,
        sleepHours: night?.totalHours,
        sleepDeepHours: night?.deepHours,
        sleepCoreHours: night?.coreHours,
        sleepRemHours: night?.remHours,
        sleepAwakeHours: night?.awakeHours,
        sleepInBedHours: night?.inBedHours,
        sleepStart: night?.start,
        sleepEnd: night?.end,
        sleepSource: night?.source,
        sleepingWristTempC: acc.sleepingWristTempCount
          ? acc.sleepingWristTempSum / acc.sleepingWristTempCount
          : undefined,
        sleepRespiratoryRate: acc.sleepRespiratoryRateCount
          ? acc.sleepRespiratoryRateSum / acc.sleepRespiratoryRateCount
          : undefined,
        exerciseMinutes: acc.exerciseMinutes || undefined,
        flightsClimbed: acc.flightsClimbed || undefined,
        vo2Max: acc.vo2MaxCount ? acc.vo2MaxSum / acc.vo2MaxCount : undefined,
        avgHrv: acc.hrvCount ? acc.hrvSum / acc.hrvCount : undefined,
        avgBloodOxygen: acc.bloodOxygenCount ? acc.bloodOxygenSum / acc.bloodOxygenCount : undefined,
      };
    })
    .filter((day) =>
      Object.entries(day).some(([key, value]) => key !== 'date' && value !== undefined),
    );
}

const WORKOUT_TYPE_MAP: Record<string, WorkoutType> = {
  // English
  running: 'RUN',
  cycling: 'RIDE',
  walking: 'WALK',
  swimming: 'SWIM',
  traditionalstrengthtraining: 'STRENGTH',
  functionalstrengthtraining: 'STRENGTH',
  coretraining: 'STRENGTH',
  badminton: 'BADMINTON',
  // Dutch (Health Auto Export follows the phone's locale)
  hardlopen: 'RUN',
  buitenrennen: 'RUN',
  fietsen: 'RIDE',
  buitenfietsen: 'RIDE',
  wandelen: 'WALK',
  wandeling: 'WALK',
  buitenwandelen: 'WALK',
  zwemmen: 'SWIM',
  buitenzwemmen: 'SWIM',
  traditionelekrachttraining: 'STRENGTH',
  functionelekrachttraining: 'STRENGTH',
  krachttraining: 'STRENGTH',
  kerntraining: 'STRENGTH',
};

export function mapWorkoutType(name: string): WorkoutType {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  return WORKOUT_TYPE_MAP[key] ?? 'OTHER';
}

export function externalWorkoutId(workout: HealthAutoExportWorkout): string {
  return workout.id ? `apple_health:${workout.id}` : `apple_health:${workout.start}`;
}
