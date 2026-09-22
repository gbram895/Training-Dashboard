import { prisma } from './prisma.js';
import { PLAUSIBLE_FTP_WATTS, PLAUSIBLE_PACE_SEC_PER_KM } from './calibration.js';

/**
 * Projects FTP and threshold pace forward to a future date.
 *
 * This is deliberately NOT a physiological model. There is no dependable
 * mapping from training load to threshold power — you can add a great deal of
 * CTL with volume and barely move your FTP — so anything claiming to derive
 * watts from a projected CTL would be making its number up. What CAN be done
 * honestly is to measure the rate at which the athlete's OWN best efforts have
 * been moving, and carry that rate forward over the build weeks the plan
 * actually has left, damped, bounded, and withheld when the data is too thin.
 *
 * Three guards, all of which matter more than the number itself:
 *
 *  - Gains are applied only over BUILD weeks. A taper doesn't raise threshold,
 *    so a goal eight weeks out with five of them spent tapering for an earlier
 *    race gets three weeks of improvement, not eight.
 *  - Improvement is damped towards an asymptote rather than extrapolated in a
 *    straight line. Someone gaining 2W a week for a month will not gain 100W in
 *    a year, and a linear projection that says so is worse than no projection.
 *  - The total change is capped, and the result is bounded by the same
 *    plausibility limits lib/calibration.ts uses before it will suggest a
 *    threshold at all. Beyond those the input was wrong, not the athlete
 *    exceptional.
 *
 * Where there isn't enough to measure from, this returns null with a reason
 * rather than a confident guess — same principle as the Calibration card, and
 * for the same reason: these numbers are the denominator of every TSS in the
 * app, so a wrong one is worse than a missing one.
 */

// Two adjacent windows, compared against each other to get a rate of change.
// 90 days each: long enough that a single big week doesn't define a window,
// short enough that the pair still describes this season rather than last.
const WINDOW_DAYS = 90;
const WINDOWS_APART_WEEKS = WINDOW_DAYS / 7;

// A best effort is taken as the mean of the top N, not the single maximum: one
// freakishly good ride shouldn't set the level for a whole window, and one
// missing week shouldn't lower it.
const TOP_N = 3;

// Below this there is no window to compare — say so rather than deriving a
// trend from two rides.
const MIN_EFFORTS_PER_WINDOW = 3;

// Only efforts long enough to say something about threshold. A 15-minute
// hammer says little about an hour's power.
const MIN_RIDE_MINUTES = 30;
const MIN_RUN_MINUTES = 20;

// Improvement flattens. `trendPerWeek * TAU * (1 - e^(-weeks/TAU))` rises at
// the measured rate initially and approaches TAU weeks' worth of gain however
// long the horizon, so a year out never projects a year of linear progress.
// 12 weeks is about the length of a block over which a rate like this holds.
const DAMPING_TAU_WEEKS = 12;

// However the maths lands, a season doesn't move a trained athlete's threshold
// by more than about this. Gains beyond it happen to people coming back from
// nothing, not to someone already training consistently.
const MAX_RELATIVE_CHANGE = 0.12;

export interface ThresholdTrend {
  /** What the app currently computes every TSS with. */
  current: number;
  /** Mean of the best few efforts in the recent window. */
  recentBest: number;
  /** The same for the window before it, which is what gives the rate. */
  olderBest: number;
  /** Rate of change per week — negative for pace means getting faster. */
  perWeek: number;
  /** How many qualifying efforts the recent window had. */
  sampleCount: number;
  /** Plain-language account of what this was measured from, for the UI. */
  basis: string;
}

export interface ThresholdTrends {
  ftp: ThresholdTrend | null;
  pace: ThresholdTrend | null;
  /** Why a missing one is missing, ready to show as-is. */
  ftpBasis: string;
  paceBasis: string;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Mean of the best TOP_N values, `better` deciding which end is best. */
function topMean(values: number[], better: 'higher' | 'lower'): number {
  const sorted = [...values].sort((a, b) => (better === 'higher' ? b - a : a - b));
  const take = sorted.slice(0, Math.min(TOP_N, sorted.length));
  return take.reduce((a, b) => a + b, 0) / take.length;
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Measures how fast the athlete's own best efforts are moving, from workout
 * summaries only — no per-second samples, so this is cheap enough to run behind
 * a page load alongside the rest of the forecast.
 *
 * Power comes from rides and pace from runs, filtered on workout type here
 * rather than on whichever rows happen to carry the field: both disciplines
 * record a speed, and reading pace off a 30 km/h gravel ride is exactly how
 * the Calibration card once suggested a threshold pace of 1:46/km.
 */
export async function measureThresholdTrends(userId: string): Promise<ThresholdTrends> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  if (!user) return { ftp: null, pace: null, ftpBasis: 'No athlete profile', paceBasis: 'No athlete profile' };

  const recentFrom = daysAgo(WINDOW_DAYS);
  const olderFrom = daysAgo(WINDOW_DAYS * 2);

  const [rides, runs] = await Promise.all([
    prisma.workout.findMany({
      where: {
        userId,
        type: 'RIDE',
        date: { gte: olderFrom },
        durationMin: { gte: MIN_RIDE_MINUTES },
        normalizedPowerWatts: { not: null },
      },
      select: { date: true, normalizedPowerWatts: true },
    }),
    prisma.workout.findMany({
      where: {
        userId,
        type: 'RUN',
        date: { gte: olderFrom },
        durationMin: { gte: MIN_RUN_MINUTES },
        distanceKm: { gt: 0 },
      },
      select: { date: true, durationMin: true, distanceKm: true },
    }),
  ]);

  const splitByWindow = <T extends { date: Date }>(rows: T[]) => ({
    recent: rows.filter((r) => r.date >= recentFrom),
    older: rows.filter((r) => r.date < recentFrom),
  });

  // --- FTP, from normalized power on rides -------------------------------
  // Normalized power over a long ride is not a threshold test, but the best few
  // of them move with the athlete's threshold, which is all a RATE needs.
  const ridePower = splitByWindow(rides);
  const recentPower = ridePower.recent.map((r) => r.normalizedPowerWatts!).filter((v) => v > 0);
  const olderPower = ridePower.older.map((r) => r.normalizedPowerWatts!).filter((v) => v > 0);

  let ftp: ThresholdTrend | null = null;
  let ftpBasis: string;
  if (recentPower.length < MIN_EFFORTS_PER_WINDOW || olderPower.length < MIN_EFFORTS_PER_WINDOW) {
    ftpBasis = `Needs ${MIN_EFFORTS_PER_WINDOW} rides of ${MIN_RIDE_MINUTES}+ minutes with power in each of the last two ${WINDOW_DAYS}-day blocks — you have ${recentPower.length} and ${olderPower.length}`;
  } else {
    const recentBest = topMean(recentPower, 'higher');
    const olderBest = topMean(olderPower, 'higher');
    const perWeek = (recentBest - olderBest) / WINDOWS_APART_WEEKS;
    ftp = {
      current: user.ftpWatts,
      recentBest: Math.round(recentBest),
      olderBest: Math.round(olderBest),
      perWeek,
      sampleCount: recentPower.length,
      basis: `Your best ${TOP_N} rides by normalized power are averaging ${Math.round(recentBest)}W, against ${Math.round(olderBest)}W the ${WINDOW_DAYS} days before — ${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(1)}W a week across ${recentPower.length} rides`,
    };
    ftpBasis = ftp.basis;
  }

  // --- Threshold pace, from runs only ------------------------------------
  const runPace = splitByWindow(runs);
  const paceOf = (r: { durationMin: number; distanceKm: number | null }) => (r.durationMin * 60) / (r.distanceKm ?? 1);
  const recentPaces = runPace.recent.map(paceOf).filter((p) => p > 0);
  const olderPaces = runPace.older.map(paceOf).filter((p) => p > 0);

  let pace: ThresholdTrend | null = null;
  let paceBasis: string;
  if (recentPaces.length < MIN_EFFORTS_PER_WINDOW || olderPaces.length < MIN_EFFORTS_PER_WINDOW) {
    paceBasis = `Needs ${MIN_EFFORTS_PER_WINDOW} runs of ${MIN_RUN_MINUTES}+ minutes with distance in each of the last two ${WINDOW_DAYS}-day blocks — you have ${recentPaces.length} and ${olderPaces.length}`;
  } else {
    const recentBest = topMean(recentPaces, 'lower');
    const olderBest = topMean(olderPaces, 'lower');
    const perWeek = (recentBest - olderBest) / WINDOWS_APART_WEEKS;
    pace = {
      current: user.thresholdPaceSecPerKm,
      recentBest: Math.round(recentBest),
      olderBest: Math.round(olderBest),
      perWeek,
      sampleCount: recentPaces.length,
      basis: `Your best ${TOP_N} runs are averaging ${formatPace(recentBest)}/km, against ${formatPace(olderBest)}/km the ${WINDOW_DAYS} days before — ${perWeek <= 0 ? '' : '+'}${perWeek.toFixed(1)}s per km a week across ${recentPaces.length} runs`,
    };
    paceBasis = pace.basis;
  }

  return { ftp, pace, ftpBasis, paceBasis };
}

/**
 * The measured rate carried forward over `buildWeeks`, damped and capped.
 * Returns null when the result leaves the bounds lib/calibration.ts trusts.
 */
function projectValue(
  trend: ThresholdTrend,
  buildWeeks: number,
  bounds: { min: number; max: number },
): number | null {
  const effectiveWeeks = DAMPING_TAU_WEEKS * (1 - Math.exp(-Math.max(0, buildWeeks) / DAMPING_TAU_WEEKS));
  const raw = trend.perWeek * effectiveWeeks;
  const cap = Math.abs(trend.current) * MAX_RELATIVE_CHANGE;
  const change = Math.max(-cap, Math.min(cap, raw));
  const projected = Math.round(trend.current + change);
  return projected >= bounds.min && projected <= bounds.max ? projected : null;
}

export function projectFtp(trend: ThresholdTrend, buildWeeks: number): number | null {
  return projectValue(trend, buildWeeks, PLAUSIBLE_FTP_WATTS);
}

export function projectThresholdPace(trend: ThresholdTrend, buildWeeks: number): number | null {
  return projectValue(trend, buildWeeks, PLAUSIBLE_PACE_SEC_PER_KM);
}
