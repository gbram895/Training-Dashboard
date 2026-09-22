import { prisma } from './prisma.js';
import { bestRollingAverage, PLAUSIBLE_FTP_WATTS } from './bestEfforts.js';

/**
 * The power curve and the critical-power model.
 *
 * A single ride tells you what the athlete did that day. The curve tells you
 * what they are capable of: the best power they have ever held for five
 * seconds, a minute, five minutes, twenty minutes — and how that compares to
 * the last three months. Nothing else in the app answers "am I getting
 * stronger, and at what?", because Fitness (CTL) measures how much training
 * has been done, not how good the athlete is.
 *
 * Two things make this cheap enough to sit behind a page load on a free-tier
 * Postgres:
 *
 *  - The expensive part (walking a ride's per-second samples for the best mean
 *    power over each duration) happens once, at import, and is stored in
 *    WorkoutPowerBest. Reading a curve is then one indexed query of a few
 *    hundred rows, whatever window it covers.
 *  - The backfill over existing rides is chunked, so it never runs longer than
 *    a single request should.
 */

/**
 * The durations the curve is sampled at. Bram asked for 5s, 1min, 5min and
 * 20min; the rest are here because four points do not draw a curve, and
 * because the critical-power fit below needs several efforts in the 2-20
 * minute range to have anything to regress.
 */
export const CURVE_DURATIONS_SEC = [5, 15, 30, 60, 120, 300, 480, 1200, 3600];

/** The four the athlete actually asked to see, shown as headline numbers. */
export const HEADLINE_DURATIONS_SEC = [5, 60, 300, 1200];

/** The best mean power over each curve duration, for one ride's samples. */
export function bestPowerEfforts(samples: { offsetSec: number; powerWatts: number | null }[]): Map<number, number> {
  const power = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .map((s) => ({ offsetSec: s.offsetSec, value: s.powerWatts }));

  const efforts = new Map<number, number>();
  if (power.length === 0) return efforts;

  for (const durationSec of CURVE_DURATIONS_SEC) {
    const watts = bestRollingAverage(power, durationSec);
    // A plausibility floor of 1W, so a ride recorded as all-zeros (a power
    // meter that never woke up) doesn't put a 0W "best" on the curve.
    if (watts != null && watts >= 1) efforts.set(durationSec, Math.round(watts));
  }
  return efforts;
}

/**
 * Extracts and stores one ride's best efforts. Stamps `powerBestsAt` either
 * way — a ride with no power is still a ride that has been looked at, and
 * stamping it is what stops the rebuild scanning it again every time.
 */
export async function storePowerBests(
  workout: { id: string; userId: string; date: Date },
  samples: { offsetSec: number; powerWatts: number | null }[],
): Promise<number> {
  const efforts = bestPowerEfforts(samples);

  await prisma.$transaction([
    prisma.workoutPowerBest.deleteMany({ where: { workoutId: workout.id } }),
    prisma.workoutPowerBest.createMany({
      data: [...efforts].map(([durationSec, watts]) => ({
        userId: workout.userId,
        workoutId: workout.id,
        date: workout.date,
        durationSec,
        watts,
      })),
    }),
    prisma.workout.update({ where: { id: workout.id }, data: { powerBestsAt: new Date() } }),
  ]);

  return efforts.size;
}

/** How many of the athlete's rides still have no efforts extracted from them. */
export function countPendingRides(userId: string): Promise<number> {
  return prisma.workout.count({ where: { userId, type: 'RIDE', powerBestsAt: null } });
}

/**
 * Walks unanalysed rides, newest first, and extracts their efforts.
 *
 * Chunked on purpose: a season of rides is hundreds of thousands of sample
 * rows, and doing them all in one request is how a free-tier instance times
 * out halfway and leaves the work half done. The caller loops on `remaining`,
 * which means progress is visible and nothing is redone on the next pass.
 */
export async function rebuildPowerBests(
  userId: string,
  limit = 20,
): Promise<{ analysed: number; withPower: number; remaining: number }> {
  const rides = await prisma.workout.findMany({
    where: { userId, type: 'RIDE', powerBestsAt: null },
    select: { id: true, userId: true, date: true },
    orderBy: { date: 'desc' },
    take: limit,
  });

  let withPower = 0;
  for (const ride of rides) {
    const samples = await prisma.workoutSample.findMany({
      where: { workoutId: ride.id },
      select: { offsetSec: true, powerWatts: true },
      orderBy: { offsetSec: 'asc' },
    });
    if ((await storePowerBests(ride, samples)) > 0) withPower++;
  }

  return { analysed: rides.length, withPower, remaining: await countPendingRides(userId) };
}

// --- The curve itself ----------------------------------------------------

export type CurveWindowKey = '90d' | '365d' | 'all';

interface WindowSpec {
  key: CurveWindowKey;
  label: string;
  days: number | null;
}

/** The three windows Bram asked for: recent form, the season, and all time. */
const WINDOWS: WindowSpec[] = [
  { key: '90d', label: 'Last 3 months', days: 90 },
  { key: '365d', label: 'Last year', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

export interface CurveEffort {
  durationSec: number;
  watts: number;
  /** When it was set, so a number can be traced back to the day it came from. */
  date: string;
  workoutId: string;
}

export interface CriticalPower {
  /** The power the model says is indefinitely sustainable, in watts. */
  cpWatts: number;
  /** Work available above CP before exhaustion, in kilojoules. */
  wPrimeKj: number;
  durationsUsedSec: number[];
  /** How well the efforts actually fit a straight line, 0-1. */
  fit: number;
}

export interface CurveWindow extends WindowSpec {
  efforts: CurveEffort[];
  criticalPower: CriticalPower | null;
  /** Rides with power in this window, so the UI can say how much it is reading. */
  rideCount: number;
}

export interface PowerCurveReport {
  durationsSec: number[];
  headlineDurationsSec: number[];
  windows: CurveWindow[];
  /** What the app currently computes every ride's training load against. */
  ftpWatts: number;
  ridesAnalysed: number;
  ridesPending: number;
}

/**
 * The 2-parameter critical-power model: over the durations where it holds,
 * total work is a straight line in time — `W = W' + CP.t`. Regressing work on
 * duration gives CP as the slope (the power that can be held without drawing
 * on anything finite) and W' as the intercept (the finite amount available
 * above it).
 *
 * Only efforts between 2 and 20 minutes are used, which is where the model is
 * known to behave: below that a sprint is almost all W' and the line bends
 * upward, above it fatigue that the model doesn't represent pulls it down, and
 * including either drags CP away from the truth.
 */
const CP_MIN_DURATION_SEC = 120;
const CP_MAX_DURATION_SEC = 1200;

// Two points define a line but say nothing about whether it is the right line,
// and the fit quality below would always read as perfect. Three is the
// smallest number that can disagree with itself.
const CP_MIN_EFFORTS = 3;

// W' outside this is not an athlete, it is bad data — a 5 kJ anaerobic
// capacity is implausibly small and 50 kJ is beyond a world-class sprinter.
const PLAUSIBLE_W_PRIME_KJ = { min: 5, max: 50 };

export function fitCriticalPower(efforts: CurveEffort[]): CriticalPower | null {
  const usable = efforts.filter(
    (e) => e.durationSec >= CP_MIN_DURATION_SEC && e.durationSec <= CP_MAX_DURATION_SEC,
  );
  if (usable.length < CP_MIN_EFFORTS) return null;

  const points = usable.map((e) => ({ t: e.durationSec, work: e.watts * e.durationSec }));
  const n = points.length;
  const meanT = points.reduce((a, p) => a + p.t, 0) / n;
  const meanW = points.reduce((a, p) => a + p.work, 0) / n;

  let covariance = 0;
  let variance = 0;
  for (const p of points) {
    covariance += (p.t - meanT) * (p.work - meanW);
    variance += (p.t - meanT) ** 2;
  }
  if (variance === 0) return null;

  const cpWatts = covariance / variance;
  const wPrimeJoules = meanW - cpWatts * meanT;

  // A model whose line runs downhill, or which needs a negative reserve to
  // explain the efforts, has been fitted to data that doesn't behave like
  // efforts at all — usually one all-out short effort and two easy long ones.
  if (cpWatts <= 0 || wPrimeJoules <= 0) return null;

  const wPrimeKj = wPrimeJoules / 1000;
  if (cpWatts < PLAUSIBLE_FTP_WATTS.min || cpWatts > PLAUSIBLE_FTP_WATTS.max) return null;
  if (wPrimeKj < PLAUSIBLE_W_PRIME_KJ.min || wPrimeKj > PLAUSIBLE_W_PRIME_KJ.max) return null;

  let residual = 0;
  let total = 0;
  for (const p of points) {
    residual += (p.work - (wPrimeJoules + cpWatts * p.t)) ** 2;
    total += (p.work - meanW) ** 2;
  }
  const fit = total === 0 ? 1 : Math.max(0, 1 - residual / total);

  return {
    cpWatts: Math.round(cpWatts),
    wPrimeKj: Math.round(wPrimeKj * 10) / 10,
    durationsUsedSec: usable.map((e) => e.durationSec),
    fit: Math.round(fit * 1000) / 1000,
  };
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * Reads the whole curve in one query.
 *
 * Every window is a subset of "all time", so all three are built from the same
 * set of rows rather than three round trips. The row count is bounded by
 * (rides with power) x (curve durations) — a few hundred for a season, not the
 * hundreds of thousands of samples they were derived from.
 */
export async function buildPowerCurve(userId: string): Promise<PowerCurveReport> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ftpWatts: true } });

  const [bests, ridesAnalysed, ridesPending] = await Promise.all([
    prisma.workoutPowerBest.findMany({
      where: { userId },
      select: { durationSec: true, watts: true, date: true, workoutId: true },
      orderBy: { watts: 'desc' },
    }),
    prisma.workout.count({ where: { userId, type: 'RIDE', powerBestsAt: { not: null } } }),
    countPendingRides(userId),
  ]);

  const windows = WINDOWS.map((spec) => {
    const from = spec.days == null ? null : daysAgo(spec.days);
    const inWindow = from == null ? bests : bests.filter((b) => b.date >= from);

    // Rows arrive watts-descending, so the first row for a duration is its best.
    const byDuration = new Map<number, (typeof inWindow)[number]>();
    for (const row of inWindow) if (!byDuration.has(row.durationSec)) byDuration.set(row.durationSec, row);

    const efforts: CurveEffort[] = CURVE_DURATIONS_SEC.flatMap((durationSec) => {
      const row = byDuration.get(durationSec);
      return row
        ? [
            {
              durationSec,
              watts: row.watts,
              date: row.date.toISOString().slice(0, 10),
              workoutId: row.workoutId,
            },
          ]
        : [];
    });

    return {
      ...spec,
      efforts,
      criticalPower: fitCriticalPower(efforts),
      rideCount: new Set(inWindow.map((b) => b.workoutId)).size,
    };
  });

  return {
    durationsSec: CURVE_DURATIONS_SEC,
    headlineDurationsSec: HEADLINE_DURATIONS_SEC,
    windows,
    ftpWatts: user?.ftpWatts ?? 0,
    ridesAnalysed,
    ridesPending,
  };
}

/**
 * The athlete's best 20-minute power over a window, read straight off the
 * stored curve.
 *
 * This is what the Calibration card's FTP suggestion is derived from. It used
 * to re-walk the samples of the 40 most recent rides on every page load, which
 * both duplicated the work done here and quietly capped the search — a 20
 * minute best set 41 rides ago simply wasn't seen. Null means the curve has
 * nothing stored for the window yet, and the caller falls back.
 */
export async function best20MinPower(
  userId: string,
  windowDays: number,
): Promise<{ watts: number; on: Date; rideCount: number } | null> {
  const from = daysAgo(windowDays);
  const [best, rideCount] = await Promise.all([
    prisma.workoutPowerBest.findFirst({
      where: { userId, durationSec: 1200, date: { gte: from } },
      select: { watts: true, date: true },
      orderBy: { watts: 'desc' },
    }),
    prisma.workoutPowerBest
      .findMany({
        where: { userId, date: { gte: from } },
        select: { workoutId: true },
        distinct: ['workoutId'],
      })
      .then((rows) => rows.length),
  ]);

  return best ? { watts: best.watts, on: best.date, rideCount } : null;
}
