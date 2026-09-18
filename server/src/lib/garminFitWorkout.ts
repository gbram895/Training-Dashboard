import { Encoder, Profile, type FileIdMesg, type WorkoutMesg, type WorkoutStepMesg } from '@garmin/fitsdk';
import type { GarminPushDiscipline, GarminPushSegment, AthleteSpeedThresholds } from './garminWorkoutPush.js';

// A .fit workout file is what Garmin Connect itself generates when you build
// a structured workout there, and what a Connect IQ app's Communications
// module can request with responseType HTTP_RESPONSE_CONTENT_TYPE_FIT and
// have parsed into a native PersistedContent.Workout automatically — no
// Garmin account login involved at all, unlike the JSON push in
// garminWorkoutPush.ts. Built with Garmin's own official FIT SDK
// (@garmin/fitsdk, already a dependency for parsing library .fit files), so
// the field names/enums here are spec-accurate rather than reverse-engineered.
//
// customTargetValueLow/High (raw field) uses FIT's "watts + 1000" encoding
// for an absolute power target (as opposed to a 1-7 zone number) when
// targetType is power — the same convention this app's own .fit *parser*
// already decodes in workoutFormats.ts's normalizePower(). For a speed
// target the same raw field is scaled x1000 (per its customTargetSpeedLow
// subfield declaration) to store m/s as an integer.
const WATTS_OFFSET = 1000;
const SPEED_SCALE = 1000;

function targetFields(
  discipline: GarminPushDiscipline,
  segment: GarminPushSegment,
  thresholds: AthleteSpeedThresholds,
): Partial<WorkoutStepMesg> {
  if (segment.intensityFraction == null) return { targetType: 'open' };
  const low = segment.intensityLow ?? segment.intensityFraction;
  const high = segment.intensityHigh ?? segment.intensityFraction;

  if (discipline === 'BIKE') {
    if (thresholds.ftpWatts <= 0) return { targetType: 'open' };
    return {
      targetType: 'power',
      customTargetValueLow: WATTS_OFFSET + Math.round(low * thresholds.ftpWatts),
      customTargetValueHigh: WATTS_OFFSET + Math.round(high * thresholds.ftpWatts),
    };
  }

  if (thresholds.thresholdSpeedMps <= 0) return { targetType: 'open' };
  return {
    targetType: 'speed',
    customTargetValueLow: Math.round(low * thresholds.thresholdSpeedMps * SPEED_SCALE),
    customTargetValueHigh: Math.round(high * thresholds.thresholdSpeedMps * SPEED_SCALE),
  };
}

function intensityFor(segment: GarminPushSegment): WorkoutStepMesg['intensity'] {
  if (segment.role === 'warmup') return 'warmup';
  if (segment.role === 'cooldown') return 'cooldown';
  if (segment.intensityFraction == null) return 'rest';
  return 'active';
}

export function buildFitWorkoutFile(
  name: string,
  discipline: GarminPushDiscipline,
  segments: GarminPushSegment[],
  thresholds: AthleteSpeedThresholds,
): Uint8Array {
  const encoder = new Encoder();

  const fileId = {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'workout',
    manufacturer: 'development',
    timeCreated: new Date(),
  };
  encoder.writeMesg(fileId);

  const sport: WorkoutMesg['sport'] = discipline === 'BIKE' ? 'cycling' : 'running';

  const workout = {
    mesgNum: Profile.MesgNum.WORKOUT,
    sport,
    numValidSteps: segments.length,
    wktName: name,
  };
  encoder.writeMesg(workout);

  segments.forEach((segment, i) => {
    const step = {
      mesgNum: Profile.MesgNum.WORKOUT_STEP,
      messageIndex: i,
      durationType: 'time',
      durationValue: Math.round(Math.max(1, segment.durationSec) * 1000),
      intensity: intensityFor(segment),
      ...targetFields(discipline, segment, thresholds),
    };
    encoder.writeMesg(step);
  });

  return encoder.close();
}
