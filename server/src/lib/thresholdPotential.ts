import { prisma } from './prisma.js';
import { PLAUSIBLE_FTP_WATTS, PLAUSIBLE_PACE_SEC_PER_KM } from './calibration.js';

/**
 * What the athlete's FTP and threshold pace could be by each goal, given the
 * training between here and there.
 *
 * This replaces an earlier attempt that measured the rate of change in recent
 * best efforts and extrapolated it. That was wrong, and wrong in a way worth
 * recording so it isn't rebuilt: normalized power and average pace track HOW
 * HARD THE ATHLETE HAS BEEN TRAINING, not what they are capable of. A block of
 * endurance base — which is what the early weeks of any build look like, and
 * what a holiday looks like too — lowers both while fitness is being built. The
 * old version read that as decline and projected it forward, so a sensible
 * training block came out as losing fitness.
 *
 * Potential is a ceiling, so it is built from the best the athlete has actually
 * DEMONSTRATED, and it never points down:
 *
 *  - The floor ("hold") is what they have already proved they can do — their
 *    hardest qualifying effort of the last year, or their configured threshold
 *    if that is higher. Already-demonstrated capability doesn't evaporate.
 *  - The ceiling ("potential") is that floor plus what a consistent build can
 *    add over the BUILD weeks before the goal, damped so a long season doesn't
 *    imply unbounded progress, and capped.
 *
 * The gap between the two is the honest shape of the answer: a range, not a
 * figure. The upside rate is an assumption about training rather than a
 * measurement of this athlete, and the UI says so — see UPSIDE_PER_BUILD_WEEK.
 */

// A year, so the demonstrated best is a real personal best rather than a
// reflection of whatever this month's training happened to look like.
const DEMONSTRATED_WINDOW_DAYS = 365;

// Only efforts long enough to say something about threshold.
const MIN_RIDE_MINUTES = 30;
const MIN_RUN_MINUTES = 20;

// One qualifying effort is enough for a ceiling — a single hard ride is proof
// you can do it. This is the difference between a ceiling and a trend, which
// needed several efforts in each of two windows before it meant anything.
const MIN_EFFORTS = 1;

// Normalized power over a hard 30+ minute ride sits a little above what's
// sustainable for an hour, by about the same margin a 20-minute test does —
// the same 0.95 lib/calibration.ts converts a 20-minute best with.
const FTP_FROM_SUSTAINED_NP = 0.95;

// Likewise a best sustained pace is a touch quicker than threshold pace.
const THRESHOLD_PACE_FROM_BEST = 1.03;

/**
 * The assumption, stated in one place so it can be argued with: a consistent
 * build week adds about this fraction of threshold. 0.4% a week is roughly
 * 1.7% a month, which is a modest, commonly quoted figure for an athlete who
 * is already training rather than starting out.
 *
 * This is NOT derived from the athlete's own data — nothing in their history
 * says what a future block will yield — which is exactly why the result is
 * presented as the top of a range and labelled an assumption in the UI.
 */
const UPSIDE_PER_BUILD_WEEK = 0.004;

// Progress flattens, so the upside approaches a limit rather than compounding:
// `rate * TAU * (1 - e^(-weeks/TAU))`. At 24 weeks a 12-week block yields about
// 3.8% and a full season about 8.5%, instead of a straight line to 20%.
const DAMPING_TAU_WEEKS = 24;

// Whatever the maths says, a season doesn't move a training athlete's threshold
// by more than about this.
const MAX_RELATIVE_GAIN = 0.12;

export interface ThresholdPotential {
  /** What the app currently computes every TSS with. */
  current: number;
  /** Best demonstrated capability: the floor the potential builds on. */
  hold: number;
  /** When that effort was, so the athlete can see what it's reading. */
  demonstratedOn: string | null;
  /** Qualifying efforts found in the window. */
  sampleCount: number;
  /** Plain-language account of what this was read off, for the UI. */
  basis: string;
}

export interface ThresholdPotentials {
  ftp: ThresholdPotential | null;
  pace: ThresholdPotential | null;
  /** Why a missing one is missing, ready to show as-is. */
  ftpBasis: string;
  paceBasis: string;
}

/** A goal's projected range: `hold` is already proved, `potential` is the upside. */
export interface PotentialRange {
  hold: number;
  potential: number;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function monthYear(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function withinBounds(value: number, bounds: { min: number; max: number }): boolean {
  return value >= bounds.min && value <= bounds.max;
}

/**
 * Finds the best each discipline has actually shown in the last year, from
 * workout summaries only — no per-second samples, so this stays cheap enough
 * to run behind a page load.
 *
 * Power comes from rides and pace from runs, filtered on workout type here
 * rather than on whichever rows carry the field: both disciplines record a
 * speed, and reading pace off a 30 km/h gravel ride is how the Calibration card
 * once suggested a threshold pace of 1:46/km.
 */
export async function measureThresholdPotentials(userId: string): Promise<ThresholdPotentials> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  if (!user) {
    return { ftp: null, pace: null, ftpBasis: 'No athlete profile', paceBasis: 'No athlete profile' };
  }

  const from = daysAgo(DEMONSTRATED_WINDOW_DAYS);
  const [rides, runs] = await Promise.all([
    prisma.workout.findMany({
      where: {
        userId,
        type: 'RIDE',
        date: { gte: from },
        durationMin: { gte: MIN_RIDE_MINUTES },
        normalizedPowerWatts: { not: null },
      },
      select: { date: true, normalizedPowerWatts: true },
    }),
    prisma.workout.findMany({
      where: {
        userId,
        type: 'RUN',
        date: { gte: from },
        durationMin: { gte: MIN_RUN_MINUTES },
        distanceKm: { gt: 0 },
      },
      select: { date: true, durationMin: true, distanceKm: true },
    }),
  ]);

  // --- FTP ---------------------------------------------------------------
  let ftp: ThresholdPotential | null = null;
  let ftpBasis: string;
  const powers = rides
    .map((r) => ({ date: r.date, value: r.normalizedPowerWatts! }))
    .filter((r) => r.value > 0);
  if (powers.length < MIN_EFFORTS) {
    ftpBasis = `No rides of ${MIN_RIDE_MINUTES}+ minutes with power data in the last year, so there's nothing to read a ceiling off`;
  } else {
    const best = powers.reduce((a, b) => (b.value > a.value ? b : a));
    const fromRides = Math.round(best.value * FTP_FROM_SUSTAINED_NP);
    // Already-demonstrated capability is the higher of what the rides show and
    // what the athlete has told the app they can do.
    const hold = Math.max(user.ftpWatts, withinBounds(fromRides, PLAUSIBLE_FTP_WATTS) ? fromRides : 0);
    ftp = {
      current: user.ftpWatts,
      hold,
      demonstratedOn: best.date.toISOString().slice(0, 10),
      sampleCount: powers.length,
      basis:
        hold > user.ftpWatts
          ? `Your hardest ride of the last year held ${Math.round(best.value)}W normalized, in ${monthYear(best.date)} — about ${fromRides}W of threshold, above the ${user.ftpWatts}W set in Settings`
          : `Your ${user.ftpWatts}W from Settings, which your rides haven't bettered in the last year (hardest was ${Math.round(best.value)}W normalized, in ${monthYear(best.date)})`,
    };
    ftpBasis = ftp.basis;
  }

  // --- Threshold pace ----------------------------------------------------
  let pace: ThresholdPotential | null = null;
  let paceBasis: string;
  const paces = runs
    .map((r) => ({ date: r.date, value: (r.durationMin * 60) / (r.distanceKm ?? 1) }))
    .filter((r) => r.value > 0);
  if (paces.length < MIN_EFFORTS) {
    paceBasis = `No runs of ${MIN_RUN_MINUTES}+ minutes with distance in the last year, so there's nothing to read a ceiling off`;
  } else {
    // Faster is a smaller number, so the best run is the minimum.
    const best = paces.reduce((a, b) => (b.value < a.value ? b : a));
    const fromRuns = Math.round(best.value * THRESHOLD_PACE_FROM_BEST);
    const hold = Math.min(
      user.thresholdPaceSecPerKm,
      withinBounds(fromRuns, PLAUSIBLE_PACE_SEC_PER_KM) ? fromRuns : Number.POSITIVE_INFINITY,
    );
    pace = {
      current: user.thresholdPaceSecPerKm,
      hold,
      demonstratedOn: best.date.toISOString().slice(0, 10),
      sampleCount: paces.length,
      basis:
        hold < user.thresholdPaceSecPerKm
          ? `Your quickest run of the last year averaged ${formatPace(best.value)}/km, in ${monthYear(best.date)} — about ${formatPace(fromRuns)}/km of threshold, quicker than the ${formatPace(user.thresholdPaceSecPerKm)}/km set in Settings`
          : `Your ${formatPace(user.thresholdPaceSecPerKm)}/km from Settings, which your runs haven't bettered in the last year (quickest was ${formatPace(best.value)}/km, in ${monthYear(best.date)})`,
    };
    paceBasis = pace.basis;
  }

  return { ftp, pace, ftpBasis, paceBasis };
}

/** The damped, capped fraction a given number of build weeks can add. */
export function upsideFraction(buildWeeks: number): number {
  const effectiveWeeks = DAMPING_TAU_WEEKS * (1 - Math.exp(-Math.max(0, buildWeeks) / DAMPING_TAU_WEEKS));
  return Math.min(MAX_RELATIVE_GAIN, UPSIDE_PER_BUILD_WEEK * effectiveWeeks);
}

/**
 * Potential FTP by a goal. Never below what's already demonstrated — a build
 * block is not a reason to project going backwards.
 */
export function projectFtpPotential(p: ThresholdPotential, buildWeeks: number): PotentialRange | null {
  const potential = Math.round(p.hold * (1 + upsideFraction(buildWeeks)));
  if (!withinBounds(p.hold, PLAUSIBLE_FTP_WATTS) || !withinBounds(potential, PLAUSIBLE_FTP_WATTS)) return null;
  return { hold: p.hold, potential };
}

/** The same for threshold pace, where getting quicker means a smaller number. */
export function projectPacePotential(p: ThresholdPotential, buildWeeks: number): PotentialRange | null {
  const potential = Math.round(p.hold * (1 - upsideFraction(buildWeeks)));
  if (!withinBounds(p.hold, PLAUSIBLE_PACE_SEC_PER_KM) || !withinBounds(potential, PLAUSIBLE_PACE_SEC_PER_KM)) {
    return null;
  }
  return { hold: p.hold, potential };
}
