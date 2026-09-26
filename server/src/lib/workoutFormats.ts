import { Decoder, Stream } from '@garmin/fitsdk';
import { XMLParser } from 'fast-xml-parser';
import { estimateIntensityAndStress, type WorkoutSegment } from './workoutIntensity.js';
import type { ParsedWorkoutFile, PlannedDiscipline } from './workoutLibrary.js';

export interface AthleteThresholds {
  ftpWatts: number;
  thresholdSpeedMps: number;
  thresholdHrBpm: number;
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
      return duration ? [{ durationSec: duration, intensityFraction: power, intensityLow: power, intensityHigh: power }] : [];
    }
    case 'Warmup':
    case 'Cooldown':
    case 'Ramp': {
      const low = toNumber(attrs['@_PowerLow']);
      const high = toNumber(attrs['@_PowerHigh']);
      const avg = low != null && high != null ? (low + high) / 2 : (low ?? high);
      const role = tag === 'Warmup' ? 'warmup' : tag === 'Cooldown' ? 'cooldown' : undefined;
      return duration
        ? [{ durationSec: duration, intensityFraction: avg, intensityLow: low ?? avg, intensityHigh: high ?? avg, role }]
        : [];
    }
    case 'IntervalsT': {
      const repeat = toNumber(attrs['@_Repeat']) ?? 1;
      const onDuration = toNumber(attrs['@_OnDuration']) ?? 0;
      const offDuration = toNumber(attrs['@_OffDuration']) ?? 0;
      const onPower = toNumber(attrs['@_OnPower']);
      const offPower = toNumber(attrs['@_OffPower']);
      const segments: WorkoutSegment[] = [];
      for (let i = 0; i < repeat; i++) {
        if (onDuration) {
          segments.push({ durationSec: onDuration, intensityFraction: onPower, intensityLow: onPower, intensityHigh: onPower });
        }
        if (offDuration) {
          segments.push({ durationSec: offDuration, intensityFraction: offPower, intensityLow: offPower, intensityHigh: offPower });
        }
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

/**
 * Threshold HR as a share of max HR — the usual rule of thumb, used to
 * estimate a max HR since there's no stored one to work from directly: to
 * resolve a target written as a percentage of max HR, and to place a
 * supra-threshold bpm target on the intensity scale below. Exported so
 * lib/garminWorkoutPush.ts's reverse conversion (fraction back to bpm, for
 * pushing a workout to a device) uses the exact same estimate.
 */
export const THRESHOLD_HR_AS_FRACTION_OF_MAX = 0.92;

/**
 * What effort at estimated max HR represents on the intensity-fraction scale
 * — the usual VO2max-to-threshold power/pace ratio (VO2max sessions commonly
 * run ~115-130% of threshold), applied to HR too so a heart-rate-prescribed
 * interval lands in the same VO2MAX band (bandForIntensity, >1.05) a power-
 * or pace-prescribed one at equivalent effort would.
 */
export const VO2MAX_FRACTION_AT_MAX_HR = 1.2;

/**
 * FIT heart-rate targets carry the same "% or bpm" ambiguity power targets do:
 * the FIT profile's `workoutHr` type declares 100 as a bpm offset, so a raw
 * value above 100 is bpm + 100 and anything at or below it is a percentage of
 * max HR.
 *
 * The result is a fraction of threshold HR, so an HR-prescribed segment lands
 * on the same 1.0-is-threshold scale as a power or pace one and every consumer
 * of a segment (the profile chart's zone colours, planned TSS, the category
 * classifier) works on it unchanged.
 *
 * Below threshold this is a plain ratio (bpm / thresholdHrBpm), same as power
 * or pace. Above it, a plain ratio badly undersells the effort: heart rate is
 * a compressed, saturating proxy near the top of the scale, so a near-max-HR
 * 30-second rep can compute to barely 1.05x threshold and land as "Threshold"
 * instead of "VO2max", even though the athlete is running far harder than
 * that. Above threshold, the bpm is instead placed between threshold (1.0)
 * and estimated max HR (VO2MAX_FRACTION_AT_MAX_HR), which is what
 * lib/garminWorkoutPush.ts's bpmForHrFraction inverts to push a segment back
 * out at (approximately) its original bpm target.
 */
function normalizeHeartRate(raw: number | undefined, thresholdHrBpm: number): number | undefined {
  if (raw == null || thresholdHrBpm <= 0) return undefined;
  const maxHrBpm = thresholdHrBpm / THRESHOLD_HR_AS_FRACTION_OF_MAX;
  const bpm = raw > 100 ? raw - 100 : (raw / 100) * maxHrBpm;
  if (bpm <= thresholdHrBpm || maxHrBpm <= thresholdHrBpm) return bpm / thresholdHrBpm;
  const aboveThreshold = (bpm - thresholdHrBpm) / (maxHrBpm - thresholdHrBpm);
  return 1 + aboveThreshold * (VO2MAX_FRACTION_AT_MAX_HR - 1);
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
  const rawName = typeof workout?.wktName === 'string' ? workout.wktName : undefined;
  // JOIN's own exports prefix every workout name with "JOIN <Sport> - ", which is
  // redundant once the name is shown next to a discipline pill on the dashboard.
  const name = rawName?.replace(/^JOIN\s+\w+\s*-\s*/i, '').trim() || rawName;
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
    let intensityLow: number | undefined;
    let intensityHigh: number | undefined;
    let targetMetric: WorkoutSegment['targetMetric'];
    // Garmin's own workout builder emits power-averaging variants like "power3s"/
    // "power10s"/"power30s" rather than plain "power". Those enum values aren't the
    // exact one the FIT profile maps to customTargetPower*, so the SDK decodes the
    // target into the generic customTargetValue* fields instead - fall back to those.
    if (discipline === 'BIKE' && targetType.startsWith('power')) {
      const rawLow = toNumber(step.customTargetPowerLow) ?? toNumber(step.customTargetValueLow);
      const rawHigh = toNumber(step.customTargetPowerHigh) ?? toNumber(step.customTargetValueHigh);
      intensityLow = normalizePower(rawLow, thresholds.ftpWatts);
      intensityHigh = normalizePower(rawHigh, thresholds.ftpWatts);
      targetMetric = 'power';
    } else if (discipline === 'RUN' && targetType.startsWith('speed')) {
      const rawLow = toNumber(step.customTargetSpeedLow) ?? toNumber(step.customTargetValueLow);
      const rawHigh = toNumber(step.customTargetSpeedHigh) ?? toNumber(step.customTargetValueHigh);
      intensityLow = rawLow != null && thresholds.thresholdSpeedMps > 0 ? rawLow / thresholds.thresholdSpeedMps : undefined;
      intensityHigh = rawHigh != null && thresholds.thresholdSpeedMps > 0 ? rawHigh / thresholds.thresholdSpeedMps : undefined;
      targetMetric = 'pace';
    } else if (targetType.startsWith('heartRate')) {
      // Heart rate is the one target that means the same thing on a bike as on
      // foot, so unlike power and pace it isn't gated on the discipline. Every
      // run workout in the library is prescribed this way ("JOIN Running -
      // 30-30's", steps named "00:30@198bpm"); without this branch each one
      // parsed as a bare list of durations with no target at all, which is why
      // they showed a flat grey bar and "-" for stress and intensity.
      const rawLow = toNumber(step.customTargetHeartRateLow) ?? toNumber(step.customTargetValueLow);
      const rawHigh = toNumber(step.customTargetHeartRateHigh) ?? toNumber(step.customTargetValueHigh);
      intensityLow = normalizeHeartRate(rawLow, thresholds.thresholdHrBpm);
      intensityHigh = normalizeHeartRate(rawHigh, thresholds.thresholdHrBpm);
      targetMetric = 'hr';
    }
    const intensityFraction =
      intensityLow != null && intensityHigh != null ? (intensityLow + intensityHigh) / 2 : (intensityLow ?? intensityHigh);

    const stepIntensity = String(step.intensity ?? '');
    const role = stepIntensity === 'warmup' ? 'warmup' : stepIntensity === 'cooldown' ? 'cooldown' : undefined;

    segments.push({
      durationSec,
      intensityFraction,
      intensityLow,
      intensityHigh,
      role,
      targetMetric: intensityFraction != null ? targetMetric : undefined,
    });
  }

  const durationMin = Math.round(segments.reduce((sum, s) => sum + s.durationSec, 0) / 60);
  const { intensity, trainingStress } = estimateIntensityAndStress(segments);

  const targetTypesSeen = [...new Set(steps.map((s) => String(s.targetType ?? 'none')))].join('/');
  console.log(
    `[workout-formats] ${path}: parsed "${name}" (${discipline}), ${steps.length} steps, ` +
      `target types ${targetTypesSeen}, ` +
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
