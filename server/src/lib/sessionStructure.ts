import { bandForIntensity, type WorkoutSegment } from './workoutIntensity.js';
import { bpmForHrFraction } from './workoutFormats.js';

/**
 * Was the session done in the shape it was written in?
 *
 * Time in a band (lib/sessionReview.ts) says whether the work happened in
 * total. It cannot tell 4 x 8 min at threshold from one 32-minute block, or
 * from three good reps and a fourth that fell apart after five minutes — and
 * those are different sessions. So this lines the planned reps up against the
 * efforts actually found in the recording, one by one, and judges each on the
 * two things a rep prescribes: how long, and how hard.
 *
 * Three steps:
 *
 *  1. The plan's steps become reps. Neighbouring steps close in intensity are
 *     merged first (an under-over is one rep, not six), then every block above
 *     easy that is not clearly easier than a working step next to it is work.
 *     The ones that are, are the recoveries, whatever band they land in — a
 *     30-30 run's recovery at 150 bpm is tempo on paper and rest in practice.
 *  2. Efforts are found in the stream: contiguous stretches above a floor set
 *     between the reps and their recoveries. Where the stream is the metric the
 *     plan was written in (power for a power ride, speed for a pace run), that
 *     floor is absolute, so a rep ridden far too soft is not found at all.
 *     Otherwise (a heart-rate run judged off its speed trace) there is no shared
 *     scale, and the floor is found from the recording's own split between
 *     working and recovering.
 *  3. Planned reps and found efforts are aligned in order, allowing for reps
 *     that never happened and efforts the plan did not ask for, and each
 *     matched rep is measured in the metric it was prescribed in: a 198 bpm rep
 *     is judged in bpm, not in the pace that happens to correspond to.
 *
 * Nothing here is stored, for the same reason nothing in the session review is.
 */

export type StructureMetric = 'power' | 'pace' | 'hr';
export type RepIntensity = 'ON' | 'UNDER' | 'OVER' | 'UNJUDGED';
export type RepVerdict = 'GOOD' | 'FAIR' | 'POOR' | 'MISSED';
export type StructureSource = 'POWER' | 'PACE' | 'HR';

export interface RepReview {
  /** 1-based, in the order the plan has them. */
  index: number;
  plannedSec: number;
  plannedTarget: string | null;
  /** Null when the rep was not found at all. */
  actualSec: number | null;
  actualValue: string | null;
  intensity: RepIntensity | null;
  verdict: RepVerdict;
}

export interface StructureReview {
  /** Which stream the efforts were found in, which is not always the one they are judged in. */
  detectedFrom: StructureSource;
  metric: StructureMetric;
  plannedSummary: string;
  actualSummary: string;
  reps: RepReview[];
  /** Hard efforts the plan had no rep for. */
  extraEfforts: number;
  /** 0-1. */
  score: number;
  note: string;
}

export interface StructureSample {
  offsetSec: number;
  heartRate: number | null;
  speedMps: number | null;
  powerWatts: number | null;
}

export interface StructureWorkout {
  type: string;
  samples: StructureSample[];
}

export interface StructureThresholds {
  ftpWatts: number;
  thresholdPaceSecPerKm: number;
  hrZone4Max: number;
}

// Steps closer than this on the threshold scale are one effort with a wobble
// in it (an under-over, a ramp in 2% steps), not separate reps.
const MERGE_STEP_DELTA = 0.12;

// Same as lib/sessionReview.ts: a longer gap is a paused recording.
const MAX_SAMPLE_GAP_SEC = 30;

// Between two workouts of a split session, so an effort can't run across them.
const WORKOUT_SEPARATOR_SEC = 60;

// A stream has to cover most of the session to be worth detecting reps in.
const MIN_COVERAGE = 0.6;

// Where the floor sits between a rep and its recovery. Below halfway, so a rep
// ridden a bit soft is still found and judged soft rather than called missing.
const FLOOR_POSITION = 0.4;

// Heart rate lags by 30-60 s, so under this a rep is over before HR has caught
// up with it. JOIN's 30-30s prescribe 198 bpm for 30 seconds: that is an
// instruction to go hard, not a number a heart reaches in half a minute. Those
// reps are judged on whether they happened and how long they were; their peak
// HR is shown but not held against them.
const HR_SHORT_REP_SEC = 120;

// Tolerance around a target before a rep counts as off it.
const RELATIVE_TOLERANCE = 0.03;
const HR_TOLERANCE_BPM = 3;

interface Block {
  durationSec: number;
  fraction: number;
  low: number;
  high: number;
  role?: 'warmup' | 'cooldown';
  metrics: WorkoutSegment['targetMetric'][];
}

interface PlannedRep {
  durationSec: number;
  fraction: number;
  low: number;
  high: number;
  metric: StructureMetric;
  /** The harder of the blocks either side of it: what the rep has to stand out from. */
  surround: number;
}

interface Effort {
  start: number;
  end: number;
}

// --- The plan's reps ---------------------------------------------------------

function toBlocks(segments: WorkoutSegment[]): Block[] | null {
  const timed = segments.filter((s) => s.durationSec > 0);
  const targeted = timed.filter((s) => s.intensityFraction != null);
  // A file that is mostly open-ended steps has no structure to hold anyone to.
  if (targeted.length === 0 || targeted.length < timed.length / 2) return null;

  const blocks: Block[] = [];
  for (const s of targeted) {
    const f = s.intensityFraction!;
    const low = s.intensityLow ?? f;
    const high = s.intensityHigh ?? f;
    const last = blocks[blocks.length - 1];
    if (last && last.role === s.role && Math.abs(last.fraction - f) < MERGE_STEP_DELTA) {
      const total = last.durationSec + s.durationSec;
      last.fraction = (last.fraction * last.durationSec + f * s.durationSec) / total;
      last.low = Math.min(last.low, low);
      last.high = Math.max(last.high, high);
      last.durationSec = total;
      last.metrics.push(s.targetMetric);
    } else {
      blocks.push({ durationSec: s.durationSec, fraction: f, low, high, role: s.role, metrics: [s.targetMetric] });
    }
  }
  return blocks;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

function plannedReps(segments: WorkoutSegment[], discipline: 'BIKE' | 'RUN'): PlannedRep[] {
  const blocks = toBlocks(segments);
  if (!blocks) return [];
  const fallbackMetric: StructureMetric = discipline === 'BIKE' ? 'power' : 'pace';

  const isBookend = (b: Block | undefined) => b?.role === 'warmup' || b?.role === 'cooldown';
  const isWork = blocks.map((b, i) => {
    if (isBookend(b)) return false;
    if (bandForIntensity(b.fraction) === 'ENDURANCE') return false;
    // A step clearly easier than a working step beside it is that step's
    // recovery. Warm-up and cool-down don't count as working steps, so the last
    // recovery before the cool-down is still a recovery and a tempo block
    // between warm-up and cool-down is still the session. The cost: a tempo
    // block run straight into a threshold one reads as the threshold rep's
    // lead-in rather than a rep of its own. Nothing in the library does that.
    return ![blocks[i - 1], blocks[i + 1]].some(
      (n) => n != null && !isBookend(n) && n.fraction - b.fraction >= MERGE_STEP_DELTA,
    );
  });

  // Consecutive work blocks are one continuous effort — nothing in the ride
  // separates them, so they can only ever be found as one.
  const reps: PlannedRep[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!isWork[i]) continue;
    let j = i;
    while (j + 1 < blocks.length && isWork[j + 1]) j++;
    const run = blocks.slice(i, j + 1);
    const durationSec = run.reduce((s, b) => s + b.durationSec, 0);
    reps.push({
      durationSec,
      fraction: run.reduce((s, b) => s + b.fraction * b.durationSec, 0) / durationSec,
      low: Math.min(...run.map((b) => b.low)),
      high: Math.max(...run.map((b) => b.high)),
      metric: mostCommon(run.flatMap((b) => b.metrics).filter((m): m is StructureMetric => m != null)) ?? fallbackMetric,
      surround: Math.max(blocks[i - 1]?.fraction ?? 0.5, blocks[j + 1]?.fraction ?? 0.5),
    });
    i = j;
  }
  return reps;
}

function shortestRecoverySec(segments: WorkoutSegment[]): number | null {
  const blocks = toBlocks(segments);
  if (!blocks) return null;
  let shortest: number | null = null;
  for (let i = 1; i < blocks.length - 1; i++) {
    const b = blocks[i];
    if (b.role) continue;
    if (blocks[i - 1].fraction - b.fraction >= MERGE_STEP_DELTA || blocks[i + 1].fraction - b.fraction >= MERGE_STEP_DELTA) {
      shortest = shortest == null ? b.durationSec : Math.min(shortest, b.durationSec);
    }
  }
  return shortest;
}

// --- The recording -----------------------------------------------------------

type Series = (number | null)[];

interface Timeline {
  power: Series;
  speed: Series;
  hr: Series;
}

/** Per-second series for each stream, split sessions laid end to end with a gap between them. */
function buildTimeline(workouts: StructureWorkout[]): Timeline {
  const timeline: Timeline = { power: [], speed: [], hr: [] };
  workouts.forEach((w, wi) => {
    if (wi > 0) for (const k of ['power', 'speed', 'hr'] as const) timeline[k] = timeline[k].concat(new Array(WORKOUT_SEPARATOR_SEC).fill(null));
    const samples = [...w.samples].sort((a, b) => a.offsetSec - b.offsetSec);
    if (samples.length === 0) return;
    const length = Math.max(0, Math.ceil(samples[samples.length - 1].offsetSec) + 1);
    const series: Record<keyof Timeline, Series> = {
      power: new Array(length).fill(null),
      speed: new Array(length).fill(null),
      hr: new Array(length).fill(null),
    };
    const pick: Record<keyof Timeline, (s: StructureSample) => number | null> = {
      power: (s) => s.powerWatts,
      speed: (s) => s.speedMps,
      hr: (s) => s.heartRate,
    };
    for (const key of ['power', 'speed', 'hr'] as const) {
      const usable = samples.filter((s) => pick[key](s) != null);
      for (let i = 0; i < usable.length; i++) {
        const from = Math.max(0, Math.floor(usable[i].offsetSec));
        const nextOffset = i + 1 < usable.length ? Math.floor(usable[i + 1].offsetSec) : from + 1;
        const to = Math.min(length, nextOffset, from + MAX_SAMPLE_GAP_SEC);
        for (let t = from; t < Math.max(to, from + 1) && t < length; t++) series[key][t] = pick[key](usable[i]);
      }
    }
    for (const k of ['power', 'speed', 'hr'] as const) timeline[k] = timeline[k].concat(series[k]);
  });
  return timeline;
}

function coverage(series: Series): number {
  if (series.length === 0) return 0;
  return series.filter((v) => v != null).length / series.length;
}

/** Centred moving average that leaves gaps as gaps. */
function smooth(series: Series, window: number): Series {
  const half = Math.floor(window / 2);
  const out: Series = new Array(series.length).fill(null);
  let sum = 0;
  let count = 0;
  // Sliding window over [i - half, i + half].
  for (let i = 0; i < Math.min(half, series.length); i++) if (series[i] != null) (sum += series[i]!), count++;
  for (let i = 0; i < series.length; i++) {
    const add = i + half;
    if (add < series.length && series[add] != null) (sum += series[add]!), count++;
    const drop = i - half - 1;
    if (drop >= 0 && series[drop] != null) (sum -= series[drop]!), count--;
    out[i] = series[i] == null || count === 0 ? null : sum / count;
  }
  return out;
}

/**
 * The value that best splits a recording into two groups (Otsu's method) — here,
 * working and recovering. Null when the two groups are too close to be two
 * things at all, which is what a steady ride looks like.
 */
function splitPoint(values: number[], minSeparation: number): number | null {
  if (values.length < 60) return null;
  // Reduced rather than spread: a long ride is tens of thousands of seconds.
  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  if (!(max > min)) return null;
  const bins = 100;
  const hist = new Array(bins).fill(0);
  for (const v of values) hist[Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins))]++;
  const total = values.length;
  const totalSum = hist.reduce((s, c, i) => s + c * i, 0);
  let bestSplit = -1;
  let bestVariance = -1;
  let lowCount = 0;
  let lowSum = 0;
  for (let i = 0; i < bins - 1; i++) {
    lowCount += hist[i];
    lowSum += hist[i] * i;
    const highCount = total - lowCount;
    if (lowCount === 0 || highCount === 0) continue;
    const lowMean = lowSum / lowCount;
    const highMean = (totalSum - lowSum) / highCount;
    const variance = lowCount * highCount * (lowMean - highMean) ** 2;
    if (variance > bestVariance) [bestVariance, bestSplit] = [variance, i];
  }
  if (bestSplit < 0) return null;
  const threshold = min + ((bestSplit + 1) / bins) * (max - min);
  const low = values.filter((v) => v < threshold);
  const high = values.filter((v) => v >= threshold);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  if (low.length === 0 || high.length === 0 || mean(high) < mean(low) * minSeparation) return null;
  return threshold;
}

function findEfforts(series: Series, floor: number, mergeGapSec: number, minLengthSec: number): Effort[] {
  const raw: Effort[] = [];
  let start = -1;
  for (let t = 0; t <= series.length; t++) {
    const on = t < series.length && series[t] != null && series[t]! >= floor;
    if (on && start < 0) start = t;
    if (!on && start >= 0) {
      raw.push({ start, end: t });
      start = -1;
    }
  }
  const merged: Effort[] = [];
  for (const e of raw) {
    const last = merged[merged.length - 1];
    if (last && e.start - last.end <= mergeGapSec) last.end = e.end;
    else merged.push({ ...e });
  }
  return merged.filter((e) => e.end - e.start >= minLengthSec);
}

// --- Lining them up ----------------------------------------------------------

const MISSED_REP_COST = 1.2;
const EXTRA_EFFORT_COST = 0.8;
// Breaks ties between equally good alignments in favour of pairing the nth
// effort with the nth rep, so three efforts against five identical reps read as
// the first three done and the last two skipped, which is how sessions end.
const ORDER_TIE_BREAK = 1e-3;

function matchCost(rep: PlannedRep, effort: Effort, i: number, j: number): number {
  const ratio = (effort.end - effort.start) / rep.durationSec;
  return Math.min(2, Math.abs(Math.log(ratio))) + ORDER_TIE_BREAK * Math.abs(i - j);
}

/**
 * Ordered alignment of planned reps against found efforts (the same dynamic
 * programme as an edit distance). Matching costs how far apart the two
 * durations are on a log scale, so a rep cut from 8 to 6 minutes still pairs
 * with its planned rep rather than being called missing next to an extra.
 */
function align(reps: PlannedRep[], efforts: Effort[]): (Effort | null)[] {
  const n = reps.length;
  const m = efforts.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][0] = i * MISSED_REP_COST;
  for (let j = 1; j <= m; j++) cost[0][j] = j * EXTRA_EFFORT_COST;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = cost[i - 1][j - 1] + matchCost(reps[i - 1], efforts[j - 1], i, j);
      cost[i][j] = Math.min(match, cost[i - 1][j] + MISSED_REP_COST, cost[i][j - 1] + EXTRA_EFFORT_COST);
    }
  }
  const matched: (Effort | null)[] = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const match = cost[i - 1][j - 1] + matchCost(reps[i - 1], efforts[j - 1], i, j);
    if (Math.abs(cost[i][j] - match) < 1e-9) {
      matched[i - 1] = efforts[j - 1];
      i--;
      j--;
    } else if (Math.abs(cost[i][j] - (cost[i - 1][j] + MISSED_REP_COST)) < 1e-9) i--;
    else j--;
  }
  return matched;
}

// --- Judging a rep -----------------------------------------------------------

function clock(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')}`;
}

function paceString(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
}

/** A target in the units it was written in, as [easier end, harder end] on an "effort" scale (W, m/s, bpm). */
function targetRange(rep: PlannedRep, t: StructureThresholds): [number, number] | null {
  if (rep.metric === 'power') return t.ftpWatts > 0 ? [rep.low * t.ftpWatts, rep.high * t.ftpWatts] : null;
  if (rep.metric === 'pace') {
    if (!(t.thresholdPaceSecPerKm > 0)) return null;
    const speed = 1000 / t.thresholdPaceSecPerKm;
    return [rep.low * speed, rep.high * speed];
  }
  return t.hrZone4Max > 0 ? [bpmForHrFraction(rep.low, t.hrZone4Max), bpmForHrFraction(rep.high, t.hrZone4Max)] : null;
}

function formatValue(value: number, metric: StructureMetric): string {
  if (metric === 'power') return `${Math.round(value)} W`;
  if (metric === 'pace') return value > 0 ? paceString(1000 / value) : '—';
  return `${Math.round(value)} bpm`;
}

function formatTarget(range: [number, number], metric: StructureMetric): string {
  const [lo, hi] = range;
  const spread = metric === 'power' ? hi - lo >= 5 : metric === 'pace' ? Math.abs(1000 / lo - 1000 / hi) >= 3 : hi - lo >= 3;
  if (!spread) return formatValue((lo + hi) / 2, metric);
  if (metric === 'pace') return `${paceString(1000 / hi).replace('/km', '')}-${paceString(1000 / lo)}`;
  const unit = metric === 'power' ? 'W' : 'bpm';
  return `${Math.round(lo)}-${Math.round(hi)} ${unit}`;
}

function mean(series: Series, from: number, to: number): { value: number | null; covered: number } {
  let sum = 0;
  let count = 0;
  for (let t = Math.max(0, from); t < Math.min(series.length, to); t++) {
    if (series[t] != null) (sum += series[t]!), count++;
  }
  const span = Math.max(1, Math.min(series.length, to) - Math.max(0, from));
  return { value: count ? sum / count : null, covered: count / span };
}

function peak(series: Series, from: number, to: number): number | null {
  let best: number | null = null;
  for (let t = Math.max(0, from); t < Math.min(series.length, to); t++) {
    if (series[t] != null && (best == null || series[t]! > best)) best = series[t];
  }
  return best;
}

/** What the rep actually came out at, in the metric it was prescribed in. */
function measureRep(rep: PlannedRep, effort: Effort, timeline: Timeline): { value: number | null; label: string | null } {
  const len = effort.end - effort.start;
  if (rep.metric === 'hr') {
    if (rep.durationSec < HR_SHORT_REP_SEC) {
      // Heart rate is still climbing when a short rep ends, so it peaks just
      // after it. Shown for interest; value stays null so it isn't judged.
      const p = peak(smooth(timeline.hr, 10), effort.start, effort.end + 20);
      return { value: null, label: p != null ? `peak ${Math.round(p)} bpm` : null };
    }
    const skip = Math.min(45, Math.round(len * 0.4));
    const { value, covered } = mean(timeline.hr, effort.start + skip, effort.end);
    return covered >= 0.5 && value != null ? { value, label: formatValue(value, 'hr') } : { value: null, label: null };
  }
  const series = rep.metric === 'power' ? timeline.power : timeline.speed;
  const { value, covered } = mean(series, effort.start, effort.end);
  return covered >= 0.5 && value != null ? { value, label: formatValue(value, rep.metric) } : { value: null, label: null };
}

function judgeIntensity(value: number | null, range: [number, number] | null, metric: StructureMetric): { intensity: RepIntensity; off: number } {
  if (value == null || range == null) return { intensity: 'UNJUDGED', off: 0 };
  const [lo, hi] = range;
  const floor = metric === 'hr' ? lo - HR_TOLERANCE_BPM : lo * (1 - RELATIVE_TOLERANCE);
  const ceiling = metric === 'hr' ? hi + HR_TOLERANCE_BPM : hi * (1 + RELATIVE_TOLERANCE);
  const mid = (lo + hi) / 2;
  if (value < floor) return { intensity: 'UNDER', off: (mid - value) / mid };
  if (value > ceiling) return { intensity: 'OVER', off: (value - mid) / mid };
  return { intensity: 'ON', off: 0 };
}

function durationScore(actualSec: number, plannedSec: number, fromHr: boolean): number {
  // Found from heart rate, an effort's edges are smeared by the lag either side,
  // so only a rep that plainly stopped early is held against it.
  if (fromHr) return actualSec / plannedSec >= 0.5 ? 1 : 0.7;
  if (plannedSec < 90 && Math.abs(actualSec - plannedSec) <= 10) return 1;
  const ratio = actualSec / plannedSec;
  if (ratio >= 0.9 && ratio <= 1.12) return 1;
  if (ratio >= 0.75 && ratio <= 1.3) return 0.7;
  return 0.4;
}

function intensityScore(intensity: RepIntensity, off: number): number {
  if (intensity === 'ON' || intensity === 'UNJUDGED') return 1;
  if (intensity === 'OVER') return off <= 0.07 ? 0.85 : 0.6;
  return off <= 0.07 ? 0.7 : 0.4;
}

// --- Putting it into words ---------------------------------------------------

function summarise(reps: PlannedRep[], ranges: (string | null)[]): string {
  const keys = reps.map((r, i) => `${Math.round(r.durationSec / 5) * 5}|${ranges[i]}`);
  if (new Set(keys).size === 1) {
    const target = ranges[0] ? ` at ${ranges[0]}` : '';
    return reps.length === 1 ? `${clock(reps[0].durationSec)}${target}` : `${reps.length} × ${clock(reps[0].durationSec)}${target}`;
  }
  return `${reps.length} efforts`;
}

function describe(results: RepReview[], extras: number): string {
  const total = results.length;
  const done = results.filter((r) => r.verdict !== 'MISSED');
  const missed = results.filter((r) => r.verdict === 'MISSED');
  const word = total === 1 ? 'rep' : 'reps';
  const parts: string[] = [];

  if (done.length === 0) {
    parts.push(total === 1 ? 'The effort the session was built around is not in the recording' : `None of the ${total} ${word} show up in the recording`);
  } else {
    const allTimed = done.every((r) => r.verdict === 'GOOD');
    const judged = done.some((r) => r.intensity !== 'UNJUDGED');
    if (missed.length === 0 && allTimed) {
      parts.push(
        total === 1
          ? `The effort was there${judged ? ' and on target' : ', at the right length'}`
          : `All ${total} ${word} there${judged ? ' and on target' : ', at the right length'}`,
      );
    } else {
      parts.push(missed.length === 0 ? `All ${total} ${word} done` : `${done.length} of ${total} ${word} done`);
      const issues: string[] = [];
      const plannedTotal = results.reduce((s, r) => s + r.plannedSec, 0);
      if (done.length === 1 && total > 1 && (done[0].actualSec ?? 0) >= plannedTotal * 0.7) {
        return `Done as one ${clock(done[0].actualSec!)} block rather than ${total} separate reps. The same time at the target, but without the recoveries it is a different session.${
          extras > 0 ? ` Plus ${extras === 1 ? 'one hard effort' : `${extras} hard efforts`} the plan did not ask for.` : ''
        }`;
      }
      const trailing = missed.length > 0 && missed.every((r, k) => r.index === total - missed.length + 1 + k);
      if (trailing && total > 1) issues.push(missed.length === 1 ? 'the last one never happened' : `the last ${missed.length} never happened`);
      else if (!trailing && missed.length > 0 && missed.length <= 2) issues.push(`${missed.map((r) => `rep ${r.index}`).join(' and ')} never happened`);
      for (const r of done) {
        if (issues.length >= 2) break;
        if (r.verdict === 'GOOD') continue;
        const short = r.actualSec != null && r.actualSec < r.plannedSec * 0.9 && r.plannedSec - r.actualSec > 10;
        const long = r.actualSec != null && r.actualSec > r.plannedSec * 1.12 && r.actualSec - r.plannedSec > 10;
        const length = short ? ` and short, ${clock(r.actualSec!)} of ${clock(r.plannedSec)}` : '';
        if (r.intensity === 'UNDER') issues.push(`rep ${r.index} was soft${length} (${r.actualValue} against ${r.plannedTarget})`);
        else if (r.intensity === 'OVER') issues.push(`rep ${r.index} ran hot${length} (${r.actualValue} against ${r.plannedTarget})`);
        else if (short) issues.push(`rep ${r.index} came up short (${clock(r.actualSec!)} of ${clock(r.plannedSec)})`);
        else if (long) issues.push(`rep ${r.index} ran long (${clock(r.actualSec!)} against ${clock(r.plannedSec)})`);
      }
      if (issues.length) parts[0] += `, but ${issues.join(' and ')}`;
    }
  }
  if (extras > 0) parts.push(`${extras === 1 ? 'One hard effort' : `${extras} hard efforts`} on top that the plan did not ask for`);
  return `${parts.join('. ')}.`;
}

// --- Entry point -------------------------------------------------------------

export function reviewStructure(
  segments: WorkoutSegment[],
  discipline: 'BIKE' | 'RUN',
  workouts: StructureWorkout[],
  thresholds: StructureThresholds,
): StructureReview | null {
  const reps = plannedReps(segments, discipline);
  if (reps.length === 0) return null;

  const wanted = discipline === 'BIKE' ? 'RIDE' : 'RUN';
  const mine = workouts.filter((w) => w.type === wanted);
  if (mine.length === 0) return null;
  const timeline = buildTimeline(mine);

  const metric = mostCommon(reps.map((r) => r.metric))!;
  const thresholdSpeed = thresholds.thresholdPaceSecPerKm > 0 ? 1000 / thresholds.thresholdPaceSecPerKm : 0;

  // Find reps in the most responsive stream there is: power, then speed, and
  // heart rate only when neither was recorded.
  let detectedFrom: StructureSource;
  let raw: Series;
  let scale: number;
  if (discipline === 'BIKE' && coverage(timeline.power) >= MIN_COVERAGE && thresholds.ftpWatts > 0) {
    [detectedFrom, raw, scale] = ['POWER', timeline.power, thresholds.ftpWatts];
  } else if (discipline === 'RUN' && coverage(timeline.speed) >= MIN_COVERAGE && thresholdSpeed > 0) {
    [detectedFrom, raw, scale] = ['PACE', timeline.speed, thresholdSpeed];
  } else if (coverage(timeline.hr) >= MIN_COVERAGE && thresholds.hrZone4Max > 0) {
    [detectedFrom, raw, scale] = ['HR', timeline.hr, thresholds.hrZone4Max];
  } else {
    return null;
  }

  const shortestRep = Math.min(...reps.map((r) => r.durationSec));
  const window = detectedFrom === 'HR' ? 5 : Math.max(3, Math.min(10, Math.round(shortestRep / 4)));
  const series = smooth(
    raw.map((v) => (v == null ? null : v / scale)),
    window,
  );

  const sameScale = (detectedFrom === 'POWER' && metric === 'power') || (detectedFrom === 'PACE' && metric === 'pace');
  let floor: number | null;
  if (sameScale) {
    floor = Math.min(...reps.map((r) => r.surround + FLOOR_POSITION * (r.fraction - r.surround)));
  } else {
    // Heart rate is compressed, so its working and recovering groups sit closer.
    floor = splitPoint(
      series.filter((v): v is number => v != null),
      detectedFrom === 'HR' ? 1.05 : 1.12,
    );
  }

  const recovery = shortestRecoverySec(segments);
  const mergeGap = Math.max(3, Math.min(20, Math.round((recovery ?? 60) * 0.3)));
  const minLength = Math.max(5, Math.round(shortestRep * 0.4));
  const efforts = floor == null ? [] : findEfforts(series, floor, mergeGap, minLength);
  const matched = align(reps, efforts);
  const extraEfforts = efforts.length - matched.filter((e) => e != null).length;

  const ranges = reps.map((r) => targetRange(r, thresholds));
  const rangeLabels = ranges.map((range, i) => (range ? formatTarget(range, reps[i].metric) : null));

  const results: RepReview[] = reps.map((rep, i) => {
    const effort = matched[i];
    if (!effort) {
      return {
        index: i + 1,
        plannedSec: rep.durationSec,
        plannedTarget: rangeLabels[i],
        actualSec: null,
        actualValue: null,
        intensity: null,
        verdict: 'MISSED',
      };
    }
    const actualSec = effort.end - effort.start;
    const measured = measureRep(rep, effort, timeline);
    const { intensity, off } = judgeIntensity(measured.value, ranges[i], rep.metric);
    const score = durationScore(actualSec, rep.durationSec, detectedFrom === 'HR') * intensityScore(intensity, off);
    return {
      index: i + 1,
      plannedSec: rep.durationSec,
      plannedTarget: rangeLabels[i],
      actualSec,
      actualValue: measured.label,
      intensity,
      verdict: score >= 0.85 ? 'GOOD' : score >= 0.55 ? 'FAIR' : 'POOR',
    };
  });

  const repScore = (r: RepReview) => (r.verdict === 'GOOD' ? 1 : r.verdict === 'FAIR' ? 0.65 : r.verdict === 'POOR' ? 0.3 : 0);
  let score = results.reduce((s, r) => s + repScore(r), 0) / results.length;
  // A handful of extra hard efforts is a different session; one is a town sign.
  if (extraEfforts >= Math.max(2, Math.ceil(reps.length * 0.25))) score *= 0.9;

  const done = results.filter((r) => r.verdict !== 'MISSED').length;
  return {
    detectedFrom,
    metric,
    plannedSummary: summarise(reps, rangeLabels),
    actualSummary: `${done} of ${reps.length} ${reps.length === 1 ? 'rep' : 'reps'}${extraEfforts > 0 ? ` + ${extraEfforts} extra` : ''}`,
    reps: results,
    extraEfforts,
    score,
    note: describe(results, extraEfforts),
  };
}
