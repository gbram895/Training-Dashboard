import { WorkoutType } from '@prisma/client';

export interface HealthAutoExportMetricEntry {
  date: string;
  source?: string;
  qty?: number;
  Avg?: number;
  Min?: number;
  Max?: number;
  totalSleep?: number;
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

function zoneFor(bpm: number, t: HrZoneThresholds): keyof HrZoneMinutes {
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
  exerciseMinutes?: number;
  flightsClimbed?: number;
  vo2Max?: number;
  avgHrv?: number;
  avgBloodOxygen?: number;
}

const KJ_TO_KCAL = 0.239006;

interface Accumulator {
  steps: number;
  distanceKm: number;
  activeEnergyKj: number;
  heartRateSum: number;
  heartRateCount: number;
  restingHeartRateSum: number;
  restingHeartRateCount: number;
  sleepHours: number;
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
    sleepHours: 0,
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
        const dateKey = entry.date.slice(0, 10);
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
            acc.sleepHours += entry.totalSleep ?? 0;
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
    .map(([date, acc]) => ({
      date,
      steps: acc.steps || undefined,
      distanceKm: acc.distanceKm || undefined,
      activeEnergyKcal: acc.activeEnergyKj ? acc.activeEnergyKj * KJ_TO_KCAL : undefined,
      avgHeartRate: acc.heartRateCount ? acc.heartRateSum / acc.heartRateCount : undefined,
      restingHeartRate: acc.restingHeartRateCount
        ? acc.restingHeartRateSum / acc.restingHeartRateCount
        : undefined,
      sleepHours: acc.sleepHours || undefined,
      exerciseMinutes: acc.exerciseMinutes || undefined,
      flightsClimbed: acc.flightsClimbed || undefined,
      vo2Max: acc.vo2MaxCount ? acc.vo2MaxSum / acc.vo2MaxCount : undefined,
      avgHrv: acc.hrvCount ? acc.hrvSum / acc.hrvCount : undefined,
      avgBloodOxygen: acc.bloodOxygenCount ? acc.bloodOxygenSum / acc.bloodOxygenCount : undefined,
    }))
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
