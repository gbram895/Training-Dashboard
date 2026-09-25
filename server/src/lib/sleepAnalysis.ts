/**
 * Apple Health's `sleep_analysis` metric, read properly.
 *
 * Health Auto Export has been sending a full stage breakdown on these entries
 * all along — deep, core (Apple's name for light sleep), REM and time awake,
 * plus when the night started and ended. The importer read `totalSleep` off
 * each entry and dropped everything else, which is why the app could only ever
 * say "7h 42m" about a night.
 *
 * A real entry, from the export for 2026-09-21:
 *
 *   {
 *     "date": "2026-09-21 00:00:00 +0200",
 *     "sleepStart": "2026-09-20 23:00:17 +0200",
 *     "sleepEnd":   "2026-09-21 07:02:08 +0200",
 *     "deep": 0.908, "core": 4.574, "rem": 2.216, "awake": 0.333,
 *     "totalSleep": 7.698, "asleep": 0, "inBed": 0,
 *     "source": "Apple Watch van Bram"
 *   }
 *
 * Three things about that shape drive everything below:
 *
 *  - Values are hours, and `deep + core + rem` equals `totalSleep` exactly.
 *    `awake` is time awake *inside* the night and is NOT part of the total.
 *  - `asleep` and `inBed` are always 0. They are the pre-stage-tracking
 *    HealthKit categories, which a watch that reports stages never writes, so
 *    a zero there means "not recorded", not "no time in bed". Time in bed has
 *    to come from the sleep window instead.
 *  - `date` is local midnight of the *wake* day, not a moment during the
 *    night — the night above starts at 23:00 the evening before. It is a day
 *    label, and the importer has always keyed off its first ten characters,
 *    which is the behaviour kept here.
 *
 * Timestamps are "YYYY-MM-DD HH:MM:SS ±HHMM", which is not ISO 8601 (space
 * instead of T, offset without a colon). V8 parses it correctly including the
 * offset — verified against this data — but it is a lenient non-standard path,
 * so parseSleepTimestamp checks the result rather than trusting it.
 */

/** A sleep_analysis entry, with every field the exporter is known to send. */
export interface SleepAnalysisEntry {
  date: string;
  source?: string;
  /** Total time asleep, in hours. Excludes `awake`. */
  totalSleep?: number;
  /** Apple's stages, in hours. `core` is light sleep; older exports say `light`. */
  deep?: number;
  core?: number;
  light?: number;
  rem?: number;
  /** Time awake within the night, in hours. */
  awake?: number;
  /** Legacy HealthKit categories. Always 0 on stage-tracking exports. */
  asleep?: number;
  inBed?: number;
  sleepStart?: string;
  sleepEnd?: string;
  inBedStart?: string;
  inBedEnd?: string;
}

/** One night, resolved. Hours throughout, to match the existing sleepHours. */
export interface SleepNight {
  totalHours: number;
  deepHours?: number;
  coreHours?: number;
  remHours?: number;
  awakeHours?: number;
  /** Lights-out to getting up. Time asleep plus time awake in the night. */
  inBedHours?: number;
  start?: Date;
  end?: Date;
  source?: string;
}

/**
 * The exporter labels the metric "hr" and the values agree, but a duration is
 * only trustworthy against the clock: nobody sleeps 400 hours, so a value that
 * large was reported in minutes by some other exporter version. Converting on
 * magnitude as well as on the units string keeps a mislabelled export from
 * writing nonsense into the database.
 */
function toHours(value: number | undefined, units: string): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  const minutes = units.toLowerCase().startsWith('min') || value > 24;
  return minutes ? value / 60 : value;
}

function parseSleepTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function sum(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

function earliest(a: Date | undefined, b: Date | undefined): Date | undefined {
  if (!a || !b) return a ?? b;
  return a < b ? a : b;
}

function latest(a: Date | undefined, b: Date | undefined): Date | undefined {
  if (!a || !b) return a ?? b;
  return a > b ? a : b;
}

function hasStages(night: SleepNight): boolean {
  return night.deepHours != null || night.coreHours != null || night.remHours != null;
}

/**
 * Add one entry into the night a given source is reporting. Today's exports
 * send a single pre-aggregated entry per night, so this usually runs once —
 * but a watch taken off and put back on can produce several, and summing is
 * the right answer for those.
 */
function mergeEntry(into: SleepNight, entry: SleepAnalysisEntry, units: string): SleepNight {
  const deep = toHours(entry.deep, units);
  const core = toHours(entry.core ?? entry.light, units);
  const rem = toHours(entry.rem, units);
  const awake = toHours(entry.awake, units);

  // An export with stages but no total still knows how long the night was:
  // asleep is deep + core + REM, with time awake deliberately left out, which
  // is exactly how the exporter computes totalSleep itself.
  const staged = deep != null || core != null || rem != null;
  const reported = toHours(entry.totalSleep ?? entry.asleep, units);
  const total = reported ?? (staged ? (deep ?? 0) + (core ?? 0) + (rem ?? 0) : undefined);

  const start = earliest(into.start, parseSleepTimestamp(entry.sleepStart ?? entry.inBedStart));
  const end = latest(into.end, parseSleepTimestamp(entry.sleepEnd ?? entry.inBedEnd));

  return {
    totalHours: into.totalHours + (total ?? 0),
    deepHours: sum(into.deepHours, deep),
    coreHours: sum(into.coreHours, core),
    remHours: sum(into.remHours, rem),
    awakeHours: sum(into.awakeHours, awake),
    // `inBed` is always 0 on these exports, so it is only used if some other
    // source ever fills it in; otherwise time in bed is derived at the end.
    inBedHours: sum(into.inBedHours, toHours(entry.inBed, units)),
    start,
    end,
    source: into.source ?? entry.source,
  };
}

/**
 * Time between lights-out and getting up. Preferred from the window the
 * watch recorded; time asleep plus time awake is the same number to within a
 * second on this data and covers an entry with no timestamps.
 */
function resolveInBedHours(night: SleepNight): number | undefined {
  if (night.inBedHours != null) return night.inBedHours;
  if (night.start && night.end) {
    const hours = (night.end.getTime() - night.start.getTime()) / 3_600_000;
    if (hours > 0 && hours <= 24) return hours;
  }
  if (night.awakeHours != null) return night.totalHours + night.awakeHours;
  return undefined;
}

/**
 * Resolve one date's sleep_analysis entries into the single night the app
 * shows. Returns null when nothing usable was reported, so a day with an
 * empty sleep metric stays blank rather than claiming zero hours of sleep.
 */
export function resolveSleepNight(entries: SleepAnalysisEntry[], units: string): SleepNight | null {
  if (entries.length === 0) return null;

  const bySource = new Map<string, SleepNight>();
  for (const entry of entries) {
    const key = entry.source ?? '';
    const current = bySource.get(key) ?? { totalHours: 0, source: entry.source };
    bySource.set(key, mergeEntry(current, entry, units));
  }

  // The source that saw the most of the night is the one that was actually
  // worn. A phone on the nightstand that noticed twenty minutes does not get
  // to overwrite a watch, and — the reason this is grouped at all — the two
  // must not be added together, which is how a night becomes fourteen hours
  // long. The old code summed every entry on the date indiscriminately.
  // Stage detail breaks a tie, a night with a breakdown being strictly more
  // informative than the same night without one.
  let best: SleepNight | null = null;
  for (const night of bySource.values()) {
    if (night.totalHours <= 0) continue;
    if (
      !best ||
      night.totalHours > best.totalHours ||
      (night.totalHours === best.totalHours && hasStages(night) && !hasStages(best))
    ) {
      best = night;
    }
  }

  if (!best) return null;
  return { ...best, inBedHours: resolveInBedHours(best) };
}

/** Deep + REM as a share of time asleep — the restorative part of a night. */
export function restorativeShare(night: {
  totalHours?: number | null;
  deepHours?: number | null;
  remHours?: number | null;
}): number | null {
  const total = night.totalHours;
  if (total == null || total <= 0) return null;
  if (night.deepHours == null && night.remHours == null) return null;
  return ((night.deepHours ?? 0) + (night.remHours ?? 0)) / total;
}

/** Time asleep as a share of the night. Null when the window is unknown. */
export function sleepEfficiency(night: {
  totalHours?: number | null;
  inBedHours?: number | null;
}): number | null {
  const { totalHours, inBedHours } = night;
  if (totalHours == null || inBedHours == null || inBedHours <= 0) return null;
  return Math.min(1, totalHours / inBedHours);
}

/**
 * How good a night was, independent of how long it was — 0-100, where 100 is
 * a night as restorative and unbroken as a good one of the athlete's own.
 *
 * The two reference points are set from months of this athlete's data rather
 * than from a textbook: deep + REM runs a little under 40% of time asleep,
 * and around 96% of the night is spent asleep rather than awake.
 *
 * Deliberately the same scoring as client/src/lib/sleep.ts. The plan's
 * readiness ceiling and the dashboard's readiness ring have to agree about
 * what a bad night is, and the two sides of this app have no shared package
 * to put it in — the same arrangement the HRV baseline rule already has.
 */
const RESTORATIVE_REFERENCE = 0.4;
const EFFICIENCY_REFERENCE = 0.95;
/** Below this, a night is mostly interrupted rather than merely imperfect. */
const EFFICIENCY_FLOOR = 0.7;

export function sleepQualityScore(night: {
  totalHours?: number | null;
  deepHours?: number | null;
  remHours?: number | null;
  inBedHours?: number | null;
}): number | null {
  const parts: number[] = [];

  const restorative = restorativeShare(night);
  if (restorative != null) parts.push(clamp((restorative / RESTORATIVE_REFERENCE) * 100));

  const efficiency = sleepEfficiency(night);
  if (efficiency != null) {
    // Efficiency bunches up near the top — every unbroken night sits between
    // 0.93 and 0.99 — so a plain ratio would score them all at ~100 and never
    // separate a broken night from a good one.
    parts.push(clamp(((efficiency - EFFICIENCY_FLOOR) / (EFFICIENCY_REFERENCE - EFFICIENCY_FLOOR)) * 100));
  }

  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
