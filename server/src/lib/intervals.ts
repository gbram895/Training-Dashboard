import { normalizeHeartRate, type AthleteThresholds } from './workoutFormats.js';
import { estimateIntensityAndStress, stressBucket, classifyWorkoutCategory, type WorkoutCategory, type WorkoutSegment } from './workoutIntensity.js';
import type { PlannedDiscipline } from './workoutLibrary.js';

// Reads planned workouts off an athlete's Intervals.icu calendar. That is
// where Rest or Train sends its plan (it has no export or API of its own), so
// reading this calendar is how its plan reaches Gradient.
//
// Intervals.icu's API is used with a personal key: HTTP Basic auth with the
// literal username "API_KEY", and athlete id "0" for "whoever owns this key".
// Its reference page is a JavaScript app that could not be read when this was
// written, so the shapes below come from its author's forum posts (the
// WorkoutDoc/Step/Value classes) and every field is treated as optional.

const API_BASE = process.env.INTERVALS_API_BASE ?? 'https://intervals.icu/api/v1';

export class IntervalsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A target as Intervals.icu writes it: one value, or a start-end range (a ramp, or a band). */
interface IntervalsValue {
  value?: number;
  start?: number;
  end?: number;
  units?: string;
}

interface IntervalsStep {
  text?: string;
  duration?: number;
  distance?: number;
  reps?: number;
  steps?: IntervalsStep[];
  warmup?: boolean;
  cooldown?: boolean;
  ramp?: boolean;
  freeride?: boolean;
  intensity?: string;
  power?: IntervalsValue;
  hr?: IntervalsValue;
  pace?: IntervalsValue;
  // Filled when the events are read with resolve=true: the same targets in
  // absolute units (watts, bpm, metres per second).
  _power?: IntervalsValue;
  _hr?: IntervalsValue;
  _pace?: IntervalsValue;
}

export interface IntervalsEvent {
  id: number | string;
  start_date_local?: string;
  category?: string;
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  icu_training_load?: number;
  workout_doc?: {
    duration?: number;
    target?: string;
    steps?: IntervalsStep[];
  } | null;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The planned workouts between two days (UTC-midnight day keys, inclusive).
 * Intervals.icu reads oldest/newest as the athlete's local dates.
 */
export async function fetchPlannedWorkouts(
  apiKey: string,
  athleteId: string,
  oldest: Date,
  newest: Date,
): Promise<IntervalsEvent[]> {
  const params = new URLSearchParams({
    oldest: ymd(oldest),
    newest: ymd(newest),
    category: 'WORKOUT',
    resolve: 'true',
  });
  const url = `${API_BASE}/athlete/${encodeURIComponent(athleteId || '0')}/events?${params}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: authHeader(apiKey),
        Accept: 'application/json',
        // Intervals.icu sits behind Cloudflare, which challenges bare library
        // user agents.
        'User-Agent': 'Mozilla/5.0 (compatible; Gradient training dashboard)',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new IntervalsError(`Could not reach Intervals.icu (${err instanceof Error ? err.message : String(err)})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new IntervalsError('Intervals.icu did not accept the API key. Check it under Settings, Developer on intervals.icu.', res.status);
  }
  if (res.status === 404) {
    throw new IntervalsError('Intervals.icu does not know that athlete id. Leave it as 0 to use the key\'s own account.', res.status);
  }
  if (res.status === 429) throw new IntervalsError('Intervals.icu is rate limiting requests; will try again later.', res.status);
  if (!res.ok) throw new IntervalsError(`Intervals.icu answered ${res.status}`, res.status);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new IntervalsError('Intervals.icu sent something other than a list of events');
  return (body as IntervalsEvent[]).filter((e) => !e.category || e.category === 'WORKOUT');
}

const BIKE_TYPES = /^(ride|virtualride|gravelride|mountainbikeride|ebikeride|emountainbikeride|velomobile|handcycle|trackride)$/i;
const RUN_TYPES = /^(run|virtualrun|trailrun)$/i;

export function disciplineForType(type: string | undefined): PlannedDiscipline | null {
  if (!type) return null;
  if (BIKE_TYPES.test(type)) return 'BIKE';
  if (RUN_TYPES.test(type)) return 'RUN';
  return null;
}

type Fractions = { low?: number; high?: number; metric: NonNullable<WorkoutSegment['targetMetric']> };

function ends(v: IntervalsValue | undefined): [number | undefined, number | undefined] {
  if (!v) return [undefined, undefined];
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const value = num(v.value);
  return [num(v.start) ?? value, num(v.end) ?? value];
}

/**
 * The percentage as the coach wrote it, read against Gradient's own
 * thresholds. Intervals.icu can also resolve targets to watts and bpm, but it
 * does so with the FTP on the Intervals.icu account, which need not be
 * Gradient's (Strava has claimed 303W where Bram's own rides say about 210W;
 * see the Calibration card). A "90%" session is a sweet spot session whatever
 * the FTP behind it, so the percentage is what says how hard the coach meant
 * it to be. The resolved absolute values are only a fallback.
 */
function powerFractions(step: IntervalsStep, t: AthleteThresholds): Fractions | null {
  const [low, high] = ends(step.power);
  const units = (step.power?.units ?? '%ftp').toLowerCase();
  if (low != null && units === '%ftp') return { low: low / 100, high: (high ?? low) / 100, metric: 'power' };
  if (t.ftpWatts <= 0) return null;
  if (low != null && (units === 'w' || units === 'watts')) {
    return { low: low / t.ftpWatts, high: (high ?? low) / t.ftpWatts, metric: 'power' };
  }
  const [wLow, wHigh] = ends(step._power);
  if (wLow != null) return { low: wLow / t.ftpWatts, high: (wHigh ?? wLow) / t.ftpWatts, metric: 'power' };
  return null; // a power zone or an MMP-relative target: nothing to place reliably
}

function hrFractions(step: IntervalsStep, t: AthleteThresholds): Fractions | null {
  if (t.thresholdHrBpm <= 0) return null;
  // normalizeHeartRate reads a raw value above 100 as bpm + 100 (the FIT
  // convention), so bpm goes in that way.
  const fromBpm = (bpm: number) => normalizeHeartRate(bpm + 100, t.thresholdHrBpm);
  const [low, high] = ends(step.hr);
  const units = (step.hr?.units ?? '').toLowerCase();
  if (low != null && units === 'bpm') return { low: fromBpm(low), high: fromBpm(high ?? low), metric: 'hr' };
  if (low != null && units === '%lthr') {
    return { low: fromBpm((low / 100) * t.thresholdHrBpm), high: fromBpm(((high ?? low) / 100) * t.thresholdHrBpm), metric: 'hr' };
  }
  if (low != null && units === '%hr') {
    return { low: normalizeHeartRate(low, t.thresholdHrBpm), high: normalizeHeartRate(high ?? low, t.thresholdHrBpm), metric: 'hr' };
  }
  const [bLow, bHigh] = ends(step._hr);
  if (bLow != null && bLow > 40) return { low: fromBpm(bLow), high: fromBpm(bHigh ?? bLow), metric: 'hr' };
  return null;
}

function paceFractions(step: IntervalsStep, t: AthleteThresholds): Fractions | null {
  if (t.thresholdSpeedMps <= 0) return null;
  const [low, high] = ends(step.pace);
  const units = (step.pace?.units ?? '%pace').toLowerCase();
  if (low != null && units === '%pace') return { low: low / 100, high: (high ?? low) / 100, metric: 'pace' };
  // Resolved pace is taken as metres per second, Intervals.icu's own unit for
  // threshold pace, but only when it looks like a running speed, since the
  // unit could not be confirmed.
  const [sLow, sHigh] = ends(step._pace);
  const plausible = (s: number | undefined) => s != null && s > 1.5 && s < 8;
  if (plausible(sLow)) return { low: sLow! / t.thresholdSpeedMps, high: (sHigh ?? sLow!) / t.thresholdSpeedMps, metric: 'pace' };
  return null;
}

function stepFractions(step: IntervalsStep, discipline: PlannedDiscipline, t: AthleteThresholds, prefer?: string): Fractions | null {
  const order =
    prefer === 'HR'
      ? [hrFractions, powerFractions, paceFractions]
      : prefer === 'PACE'
        ? [paceFractions, hrFractions, powerFractions]
        : prefer === 'POWER' || discipline === 'BIKE'
          ? [powerFractions, hrFractions, paceFractions]
          : [paceFractions, hrFractions, powerFractions];
  for (const read of order) {
    const found = read(step, t);
    if (found && (found.low != null || found.high != null)) return found;
  }
  return null;
}

/** Duration of a step in seconds, estimating it from distance and target speed when only a distance is given. */
function stepSeconds(step: IntervalsStep, discipline: PlannedDiscipline, t: AthleteThresholds): number | null {
  if (typeof step.duration === 'number' && step.duration > 0) return step.duration;
  if (typeof step.distance === 'number' && step.distance > 0) {
    const [sLow, sHigh] = ends(step._pace);
    const speed = sLow != null && sLow > 1 ? (sLow + (sHigh ?? sLow)) / 2 : discipline === 'RUN' ? t.thresholdSpeedMps * 0.8 : 8;
    return speed > 0 ? Math.round(step.distance / speed) : null;
  }
  return null;
}

/** Flattens repeats and turns each step into a segment on the 1.0-is-threshold scale every other part of the plan uses. */
export function segmentsFromSteps(
  steps: IntervalsStep[] | undefined,
  discipline: PlannedDiscipline,
  t: AthleteThresholds,
  prefer?: string,
  depth = 0,
): WorkoutSegment[] {
  if (!Array.isArray(steps) || depth > 4) return [];
  const out: WorkoutSegment[] = [];
  for (const step of steps) {
    if (Array.isArray(step.steps) && step.steps.length) {
      const inner = segmentsFromSteps(step.steps, discipline, t, prefer, depth + 1);
      const reps = Math.min(Math.max(1, Math.round(step.reps ?? 1)), 50);
      for (let i = 0; i < reps; i++) out.push(...inner.map((s) => ({ ...s })));
      continue;
    }
    const durationSec = stepSeconds(step, discipline, t);
    if (!durationSec) continue;
    const target = step.freeride ? null : stepFractions(step, discipline, t, prefer);
    const low = target?.low ?? target?.high;
    const high = target?.high ?? target?.low;
    const intensityFraction = low != null && high != null ? (low + high) / 2 : undefined;
    const role =
      step.warmup || step.intensity === 'warmup' ? 'warmup' : step.cooldown || step.intensity === 'cooldown' ? 'cooldown' : undefined;
    out.push({
      durationSec,
      intensityFraction,
      intensityLow: intensityFraction != null ? Math.min(low!, high!) : undefined,
      intensityHigh: intensityFraction != null ? Math.max(low!, high!) : undefined,
      role,
      targetMetric: intensityFraction != null ? target!.metric : undefined,
    });
  }
  return out;
}

export interface ImportedWorkout {
  externalId: string;
  name: string;
  discipline: PlannedDiscipline;
  durationMin?: number;
  intensity?: number;
  trainingStress?: number;
  category?: WorkoutCategory;
  profile?: string;
  segments: WorkoutSegment[];
  /** Local wall-clock start, "HH:MM", when one was set (not midnight). */
  startTime?: string;
}

/** Rest or Train names every workout it sends "RestOrTrain: ..."; the source is shown elsewhere. */
function cleanName(name: string | undefined, type: string | undefined): string {
  const cleaned = (name ?? '').replace(/^\s*rest\s*or\s*train\s*[:\-–]\s*/i, '').trim();
  return cleaned || `${type ?? 'Planned'} workout`;
}

export function toImportedWorkout(event: IntervalsEvent, t: AthleteThresholds): ImportedWorkout | null {
  const discipline = disciplineForType(event.type);
  if (!discipline) return null;
  const doc = event.workout_doc ?? undefined;
  const segments = segmentsFromSteps(doc?.steps, discipline, t, doc?.target);
  const segmentSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const totalSec = segmentSec || doc?.duration || event.moving_time || 0;
  const estimated = estimateIntensityAndStress(segments);
  // Without targets to work from, Intervals.icu's own planned load is the
  // best guess at how big the session is.
  const trainingStress =
    estimated.trainingStress ??
    (typeof event.icu_training_load === 'number' && event.icu_training_load > 0 ? stressBucket(event.icu_training_load) : undefined);
  const time = event.start_date_local?.slice(11, 16);
  return {
    externalId: String(event.id),
    name: cleanName(event.name, event.type),
    discipline,
    durationMin: totalSec ? Math.round(totalSec / 60) : undefined,
    intensity: estimated.intensity,
    trainingStress,
    category: classifyWorkoutCategory(segments, estimated.intensity),
    profile: event.description?.trim() || undefined,
    segments,
    startTime: time && time !== '00:00' ? time : undefined,
  };
}
