import { Decoder, Stream } from '@garmin/fitsdk';
import { XMLParser } from 'fast-xml-parser';
import { estimateIntensityAndStress, type WorkoutSegment } from './workoutIntensity.js';
import type { ParsedWorkoutFile, PlannedDiscipline } from './workoutLibrary.js';

export interface AthleteThresholds {
  ftpWatts: number;
  thresholdSpeedMps: number;
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// --- ZWO (Zwift workout XML) -------------------------------------------

function zwoBlockToSegments(tag: string, attrs: Record<string, unknown>): WorkoutSegment[] {
  const duration = toNumber(attrs['@_Duration']);

  switch (tag) {
    case 'SteadyState': {
      const power = toNumber(attrs['@_Power']);
      return duration ? [{ durationSec: duration, intensityFraction: power }] : [];
    }
    case 'Warmup':
    case 'Cooldown':
    case 'Ramp': {
      const low = toNumber(attrs['@_PowerLow']);
      const high = toNumber(attrs['@_PowerHigh']);
      const avg = low != null && high != null ? (low + high) / 2 : (low ?? high);
      return duration ? [{ durationSec: duration, intensityFraction: avg }] : [];
    }
    case 'IntervalsT': {
      const repeat = toNumber(attrs['@_Repeat']) ?? 1;
      const onDuration = toNumber(attrs['@_OnDuration']) ?? 0;
      const offDuration = toNumber(attrs['@_OffDuration']) ?? 0;
      const onPower = toNumber(attrs['@_OnPower']);
      const offPower = toNumber(attrs['@_OffPower']);
      const segments: WorkoutSegment[] = [];
      for (let i = 0; i < repeat; i++) {
        if (onDuration) segments.push({ durationSec: onDuration, intensityFraction: onPower });
        if (offDuration) segments.push({ durationSec: offDuration, intensityFraction: offPower });
      }
      return segments;
    }
    default:
      // FreeRide and anything unrecognized: counts toward duration, not toward intensity.
      return duration ? [{ durationSec: duration }] : [];
  }
}

export function parseZwoFile(path: string, xml: string): ParsedWorkoutFile | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }

  const wf = doc?.workout_file;
  if (!wf) return null;

  const name = typeof wf.name === 'string' ? wf.name : wf.name?.['#text'];
  if (!name) return null;

  const sportType = String(wf.sportType ?? 'bike').toLowerCase();
  const discipline: PlannedDiscipline = sportType.includes('run') ? 'RUN' : 'BIKE';

  const blocks = wf.workout ?? {};
  const segments: WorkoutSegment[] = [];
  for (const [tag, value] of Object.entries(blocks)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item && typeof item === 'object') segments.push(...zwoBlockToSegments(tag, item as Record<string, unknown>));
    }
  }

  const durationMin = Math.round(segments.reduce((sum, s) => sum + s.durationSec, 0) / 60);
  const { intensity, trainingStress } = estimateIntensityAndStress(segments);

  return {
    path,
    name,
    discipline,
    durationMin: durationMin || undefined,
    intensity,
    trainingStress,
    profile: typeof wf.description === 'string' ? wf.description : undefined,
    segments,
  };
}

// --- FIT (Garmin structured workout) ------------------------------------

/**
 * FIT power targets are documented only as "% or watts" with no field to
 * disambiguate. The convention used across the FIT ecosystem: a raw value
 * under 1000 is a percentage of FTP; 1000+ encodes absolute watts as
 * (watts + 1000).
 */
function normalizePower(raw: number | undefined, ftpWatts: number): number | undefined {
  if (raw == null || ftpWatts <= 0) return undefined;
  if (raw >= 1000) return (raw - 1000) / ftpWatts;
  return raw / 100;
}

export function parseFitWorkoutFile(
  path: string,
  buffer: Buffer,
  thresholds: AthleteThresholds,
): ParsedWorkoutFile | null {
  const stream = Stream.fromBuffer(buffer);
  if (!Decoder.isFIT(stream)) {
    console.warn(`[workout-formats] ${path}: not recognized as a FIT file`);
    return null;
  }

  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();
  if (errors.length > 0) {
    console.warn(`[workout-formats] ${path}: FIT decode errors:`, errors);
  }

  const workout = messages.workoutMesgs?.[0];
  const name = typeof workout?.wktName === 'string' ? workout.wktName : undefined;
  if (!workout || !name) {
    console.warn(
      `[workout-formats] ${path}: no usable workout found. Message types present: ${Object.keys(messages).join(', ')}.`,
      workout ? `workoutMesgs[0]: ${JSON.stringify(workout)}` : '(no workoutMesgs at all)',
    );
    return null;
  }

  const sport = String(workout.sport ?? '').toLowerCase();
  const discipline: PlannedDiscipline = sport.includes('run') ? 'RUN' : 'BIKE';

  const steps = messages.workoutStepMesgs ?? [];
  const segments: WorkoutSegment[] = [];
  for (const step of steps) {
    const durationSec = toNumber(step.durationTime);
    if (!durationSec) continue; // skip distance/reps/HR-bounded/open-ended steps

    const targetType = String(step.targetType ?? '');
    let intensityFraction: number | undefined;
    // Garmin's own workout builder emits power-averaging variants like "power3s"/
    // "power10s"/"power30s" rather than plain "power". Those enum values aren't the
    // exact one the FIT profile maps to customTargetPower*, so the SDK decodes the
    // target into the generic customTargetValue* fields instead - fall back to those.
    if (discipline === 'BIKE' && targetType.startsWith('power')) {
      const rawLow = toNumber(step.customTargetPowerLow) ?? toNumber(step.customTargetValueLow);
      const rawHigh = toNumber(step.customTargetPowerHigh) ?? toNumber(step.customTargetValueHigh);
      const low = normalizePower(rawLow, thresholds.ftpWatts);
      const high = normalizePower(rawHigh, thresholds.ftpWatts);
      intensityFraction = low != null && high != null ? (low + high) / 2 : (low ?? high);
    } else if (discipline === 'RUN' && targetType.startsWith('speed')) {
      const low = toNumber(step.customTargetSpeedLow) ?? toNumber(step.customTargetValueLow);
      const high = toNumber(step.customTargetSpeedHigh) ?? toNumber(step.customTargetValueHigh);
      const avgSpeed = low != null && high != null ? (low + high) / 2 : (low ?? high);
      intensityFraction =
        avgSpeed != null && thresholds.thresholdSpeedMps > 0 ? avgSpeed / thresholds.thresholdSpeedMps : undefined;
    }

    segments.push({ durationSec, intensityFraction });
  }

  const durationMin = Math.round(segments.reduce((sum, s) => sum + s.durationSec, 0) / 60);
  const { intensity, trainingStress } = estimateIntensityAndStress(segments);

  console.log(
    `[workout-formats] ${path}: parsed "${name}" (${discipline}), ${steps.length} steps, ` +
      `${segments.filter((s) => s.intensityFraction != null).length}/${segments.length} segments with a usable target, ` +
      `durationMin=${durationMin}, intensity=${intensity}, trainingStress=${trainingStress}`,
  );
  if (steps.length > 0) {
    console.log(`[workout-formats] ${path}: raw steps:`, JSON.stringify(steps));
  }

  return {
    path,
    name,
    discipline,
    durationMin: durationMin || undefined,
    intensity,
    trainingStress,
    profile: undefined,
    segments,
  };
}
