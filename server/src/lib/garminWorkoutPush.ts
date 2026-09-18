import { prisma } from './prisma.js';
import { garminClientFromTokens, type GarminTokens } from './garmin.js';

export interface GarminPushSegment {
  durationSec: number;
  intensityFraction?: number;
  intensityLow?: number;
  intensityHigh?: number;
  role?: 'warmup' | 'cooldown';
}

export type GarminPushDiscipline = 'BIKE' | 'RUN';

// Garmin Connect's workout-service JSON has no published spec — Garmin only
// grants API docs to approved partners. These numeric IDs are reverse-engineered
// values used by every community tool that builds structured workouts (the
// garmin-connect package's own bundled RunningTemplate, mkuthan/garmin-workouts):
// sportType 1/2 = running/cycling, stepType 1/2/3/5 = warmup/cooldown/interval/rest,
// endCondition 2 = time, targetType 1/2/6 = no.target/power.zone/pace.zone.
const SPORT_TYPE = {
  BIKE: { sportTypeId: 2, sportTypeKey: 'cycling' },
  RUN: { sportTypeId: 1, sportTypeKey: 'running' },
} as const;

const STEP_TYPE = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  rest: { stepTypeId: 5, stepTypeKey: 'rest' },
} as const;

const TIME_END_CONDITION = { conditionTypeId: 2, conditionTypeKey: 'time' };
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' };
const POWER_ZONE_TARGET = { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' };
const PACE_ZONE_TARGET = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };

interface GarminZoneRef {
  workoutTargetTypeId: number;
  workoutTargetTypeKey: string;
}

// The garmin-connect package's own IWorkoutDetail/IWorkoutStep types declare
// several fields as required non-null (equipmentType, strokeType, category, ...)
// that the real, reverse-engineered API doesn't need — its own bundled
// RunningTemplate omits most of them at runtime. Building our own loose shape
// and asserting it at the call site avoids fighting typings that don't match
// the actual wire format.
interface GarminStepPayload {
  type: 'ExecutableStepDTO';
  stepId: null;
  stepOrder: number;
  childStepId: null;
  description: null;
  stepType: { stepTypeId: number; stepTypeKey: string };
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  endConditionValue: number;
  preferredEndConditionUnit: null;
  endConditionCompare: null;
  endConditionZone: null;
  targetType: GarminZoneRef;
  targetValueOne: number | null;
  targetValueTwo: number | null;
  zoneNumber: null;
}

export interface GarminWorkoutPayload {
  workoutName: string;
  sportType: { sportTypeId: number; sportTypeKey: string };
  workoutSegments: {
    segmentOrder: number;
    sportType: { sportTypeId: number; sportTypeKey: string };
    workoutSteps: GarminStepPayload[];
  }[];
}

export interface AthleteSpeedThresholds {
  ftpWatts: number;
  thresholdSpeedMps: number;
}

function stepTypeFor(segment: GarminPushSegment): { stepTypeId: number; stepTypeKey: string } {
  if (segment.role === 'warmup') return STEP_TYPE.warmup;
  if (segment.role === 'cooldown') return STEP_TYPE.cooldown;
  if (segment.intensityFraction == null) return STEP_TYPE.rest;
  return STEP_TYPE.interval;
}

function targetFor(
  discipline: GarminPushDiscipline,
  segment: GarminPushSegment,
  thresholds: AthleteSpeedThresholds,
): { targetType: GarminZoneRef; targetValueOne: number | null; targetValueTwo: number | null } {
  if (segment.intensityFraction == null) return { targetType: NO_TARGET, targetValueOne: null, targetValueTwo: null };
  const low = segment.intensityLow ?? segment.intensityFraction;
  const high = segment.intensityHigh ?? segment.intensityFraction;

  if (discipline === 'BIKE') {
    if (thresholds.ftpWatts <= 0) return { targetType: NO_TARGET, targetValueOne: null, targetValueTwo: null };
    return {
      targetType: POWER_ZONE_TARGET,
      targetValueOne: Math.round(low * thresholds.ftpWatts),
      targetValueTwo: Math.round(high * thresholds.ftpWatts),
    };
  }

  if (thresholds.thresholdSpeedMps <= 0) return { targetType: NO_TARGET, targetValueOne: null, targetValueTwo: null };
  return {
    targetType: PACE_ZONE_TARGET,
    targetValueOne: low * thresholds.thresholdSpeedMps,
    targetValueTwo: high * thresholds.thresholdSpeedMps,
  };
}

export function buildGarminWorkoutPayload(
  name: string,
  discipline: GarminPushDiscipline,
  segments: GarminPushSegment[],
  thresholds: AthleteSpeedThresholds,
): GarminWorkoutPayload {
  const sportType = SPORT_TYPE[discipline];
  const workoutSteps: GarminStepPayload[] = segments.map((segment, i) => ({
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder: i + 1,
    childStepId: null,
    description: null,
    stepType: stepTypeFor(segment),
    endCondition: TIME_END_CONDITION,
    endConditionValue: Math.max(1, Math.round(segment.durationSec)),
    preferredEndConditionUnit: null,
    endConditionCompare: null,
    endConditionZone: null,
    ...targetFor(discipline, segment, thresholds),
    zoneNumber: null,
  }));

  return {
    workoutName: name,
    sportType,
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps }],
  };
}

/** Same fraction-of-threshold basis the web dashboard uses for Garmin/WorkoutKit targets. */
export async function loadAthleteSpeedThresholds(userId: string): Promise<AthleteSpeedThresholds> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  return {
    ftpWatts: user.ftpWatts,
    thresholdSpeedMps: user.thresholdPaceSecPerKm > 0 ? 1000 / user.thresholdPaceSecPerKm : 0,
  };
}

export async function pushWorkoutToGarmin(
  userId: string,
  name: string,
  discipline: GarminPushDiscipline,
  segments: GarminPushSegment[],
): Promise<{ workoutId: string | null }> {
  const config = await prisma.garminSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Garmin is not connected for this account');

  const thresholds = await loadAthleteSpeedThresholds(userId);

  const tokens: GarminTokens = { oauth1: JSON.parse(config.oauth1Token), oauth2: JSON.parse(config.oauth2Token) };
  const client = garminClientFromTokens(tokens);

  const payload = buildGarminWorkoutPayload(name, discipline, segments, thresholds);
  const created = await client.addWorkout(payload as unknown as Parameters<typeof client.addWorkout>[0]);

  const refreshed = client.exportToken();
  await prisma.garminSyncConfig.update({
    where: { userId },
    data: { oauth1Token: JSON.stringify(refreshed.oauth1), oauth2Token: JSON.stringify(refreshed.oauth2) },
  });

  const workoutId = (created as { workoutId?: string | number } | undefined)?.workoutId;
  return { workoutId: workoutId != null ? String(workoutId) : null };
}
