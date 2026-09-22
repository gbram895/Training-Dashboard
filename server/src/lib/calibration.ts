import { prisma } from './prisma.js';
import { bestRollingAverage, PLAUSIBLE_FTP_WATTS, PLAUSIBLE_PACE_SEC_PER_KM } from './bestEfforts.js';
import { best20MinPower } from './powerCurve.js';

// Re-exported because they are part of this module's contract to the rest of
// the app (lib/thresholdPotential.ts bounds its projections with them); they
// live in bestEfforts.js so the power curve can share them without importing
// this module back. See lib/bestEfforts.ts.
export { PLAUSIBLE_FTP_WATTS, PLAUSIBLE_PACE_SEC_PER_KM };

/**
 * Derives FTP, threshold pace and heart-rate zones from what the athlete has
 * actually done, rather than leaving them as numbers typed into Settings once
 * and never revisited.
 *
 * This matters more than it looks: every TSS in the app is a duration scaled by
 * (effort / threshold)^2, so a threshold that is 20% off moves every training
 * load number by ~45%, and with it Fitness, Fatigue, Form, the readiness ring,
 * the workout library's difficulty ratings and which session the plan picks
 * today. Nothing in the app noticed when those numbers drifted, because nothing
 * ever compared them to the athlete's own data.
 *
 * Nothing here writes to the user — suggestions are surfaced alongside the
 * current values and applied only when the athlete says so (see
 * routes/settings.ts), since accepting one rescales their entire history.
 */

const WINDOW_DAYS = 90;

// A 20-minute maximal effort is the standard field test for both FTP and
// threshold pace, which is why both use it here.
const TEST_WINDOW_SEC = 20 * 60;

// FTP is conventionally 95% of a 20-minute best — the 20-minute number is
// slightly above what's sustainable for an hour.
const FTP_FROM_20MIN = 0.95;

// Threshold pace is a touch slower than 20-minute race pace, by about the same
// margin in the other direction.
const THRESHOLD_PACE_FROM_20MIN = 1.03;

// Percent-of-max-HR zone boundaries — the same model Strava uses when it has a
// max HR and no lab test to work from.
const ZONE_FRACTIONS_OF_MAX = [0.68, 0.83, 0.91, 0.99];

// A single spurious spike (a strap misreading at the start of a ride) shouldn't
// set the ceiling for every zone, so the max is taken as the highest value that
// is sustained for at least this long.
const MAX_HR_WINDOW_SEC = 30;

// Heart rate is only used here, so its bounds stay local.
const PLAUSIBLE_MAX_HR_BPM = { min: 120, max: 220 };

function withinBounds(value: number | null, bounds: { min: number; max: number }): number | null {
  if (value == null) return null;
  return value >= bounds.min && value <= bounds.max ? value : null;
}

export interface Suggestion<T> {
  current: T;
  suggested: T | null;
  /** Plain-language account of what the suggestion was derived from, for the UI. */
  basis: string;
}

export interface CalibrationReport {
  windowDays: number;
  ftpWatts: Suggestion<number>;
  thresholdPaceSecPerKm: Suggestion<number>;
  hrZones: Suggestion<{ hrZone1Max: number; hrZone2Max: number; hrZone3Max: number; hrZone4Max: number }>;
}

function since(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

// Enough sessions to find a real 20-minute best without walking a whole
// season of per-second data on a free-tier Postgres — this runs synchronously
// behind a page load.
const MAX_WORKOUTS_EXAMINED = 40;

/**
 * Walks the window's rides and runs one at a time rather than loading every
 * sample at once. Only those two types carry the power and pace streams the
 * thresholds are derived from, and they're also where a max heart rate
 * actually gets reached, so nothing is lost by skipping the rest.
 */
async function eachWorkoutSamples(
  userId: string,
  visit: (
    type: 'RIDE' | 'RUN',
    samples: { offsetSec: number; heartRate: number | null; speedMps: number | null; powerWatts: number | null }[],
  ) => void,
): Promise<void> {
  const workouts = await prisma.workout.findMany({
    where: { userId, date: { gte: since(WINDOW_DAYS) }, type: { in: ['RIDE', 'RUN'] } },
    select: { id: true, type: true },
    orderBy: { date: 'desc' },
    take: MAX_WORKOUTS_EXAMINED,
  });
  for (const { id, type } of workouts) {
    const samples = await prisma.workoutSample.findMany({
      where: { workoutId: id },
      select: { offsetSec: true, heartRate: true, speedMps: true, powerWatts: true },
      orderBy: { offsetSec: 'asc' },
    });
    if (samples.length > 0) visit(type as 'RIDE' | 'RUN', samples);
  }
}

export async function buildCalibrationReport(userId: string): Promise<CalibrationReport> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ftpWatts: true,
      thresholdPaceSecPerKm: true,
      hrZone1Max: true,
      hrZone2Max: true,
      hrZone3Max: true,
      hrZone4Max: true,
    },
  });
  if (!user) throw new Error('User not found');

  // FTP comes off the stored power curve when there is one: it already holds
  // the best 20 minutes of every ride ever analysed, which is both cheaper to
  // read and a wider search than the walk below, which only ever looked at the
  // 40 most recent rides. See lib/powerCurve.ts.
  const curveBest = await best20MinPower(userId, WINDOW_DAYS);

  let bestPower: number | null = null;
  let bestSpeed: number | null = null;
  let bestHr: number | null = null;
  let rideCount = 0;
  let runCount = 0;

  await eachWorkoutSamples(userId, (type, samples) => {
    const hr = samples
      .filter((s): s is typeof s & { heartRate: number } => s.heartRate != null)
      .map((s) => ({ offsetSec: s.offsetSec, value: s.heartRate }));
    const sustainedHr = bestRollingAverage(hr, MAX_HR_WINDOW_SEC);
    if (sustainedHr != null && (bestHr == null || sustainedHr > bestHr)) bestHr = sustainedHr;

    // Both disciplines carry a speed stream and a rider is far faster than a
    // runner, so pace has to be read from runs alone — reading it from whatever
    // happened to have a speed stream turned 30 km/h gravel rides into a
    // "threshold pace" of 1:46/km.
    // Only walked when the curve has nothing for this window — an athlete
    // whose rides have never been analysed still gets a suggestion.
    if (type === 'RIDE' && curveBest == null) {
      const power = samples
        .filter((s): s is typeof s & { powerWatts: number } => s.powerWatts != null)
        .map((s) => ({ offsetSec: s.offsetSec, value: s.powerWatts }));
      if (power.length > 0) {
        rideCount++;
        const p = bestRollingAverage(power, TEST_WINDOW_SEC);
        if (p != null && (bestPower == null || p > bestPower)) bestPower = p;
      }
    }

    if (type === 'RUN') {
      const speed = samples
        .filter((s): s is typeof s & { speedMps: number } => s.speedMps != null && s.speedMps > 0)
        .map((s) => ({ offsetSec: s.offsetSec, value: s.speedMps }));
      if (speed.length > 0) {
        runCount++;
        const v = bestRollingAverage(speed, TEST_WINDOW_SEC);
        if (v != null && (bestSpeed == null || v > bestSpeed)) bestSpeed = v;
      }
    }
  });

  const best20Power: number | null = curveBest ? curveBest.watts : bestPower;
  const powerRideCount = curveBest ? curveBest.rideCount : rideCount;
  const best20Speed: number | null = bestSpeed;
  const maxHr: number | null = bestHr;

  const suggestedFtp = withinBounds(
    best20Power != null ? Math.round(best20Power * FTP_FROM_20MIN) : null,
    PLAUSIBLE_FTP_WATTS,
  );
  const suggestedPace = withinBounds(
    best20Speed != null ? Math.round((1000 / best20Speed) * THRESHOLD_PACE_FROM_20MIN) : null,
    PLAUSIBLE_PACE_SEC_PER_KM,
  );

  // Runs often arrive without a speed stream (Apple Health imports carry heart
  // rate only), so fall back to the fastest whole run of at least 20 minutes.
  let paceBasis =
    suggestedPace != null
      ? `Your best 20 minutes of running (${formatPace(1000 / best20Speed!)}/km), across ${runCount} run${runCount === 1 ? '' : 's'} with pace data`
      : '';
  let fallbackPace: number | null = null;
  if (suggestedPace == null) {
    const runs = await prisma.workout.findMany({
      where: { userId, type: 'RUN', date: { gte: since(WINDOW_DAYS) }, durationMin: { gte: 20 }, distanceKm: { gt: 0 } },
      select: { durationMin: true, distanceKm: true },
    });
    for (const r of runs) {
      const pace = (r.durationMin * 60) / (r.distanceKm ?? 1);
      if (fallbackPace == null || pace < fallbackPace) fallbackPace = pace;
    }
    fallbackPace = withinBounds(fallbackPace != null ? Math.round(fallbackPace) : null, PLAUSIBLE_PACE_SEC_PER_KM);
    if (fallbackPace != null) {
      paceBasis = `No pace data on your recent runs — taken from your fastest full run (${formatPace(fallbackPace)}/km) over ${runs.length} run${runs.length === 1 ? '' : 's'}`;
    }
  }

  const plausibleMaxHr = withinBounds(maxHr, PLAUSIBLE_MAX_HR_BPM);
  const suggestedZones =
    plausibleMaxHr != null
      ? {
          hrZone1Max: Math.round(plausibleMaxHr * ZONE_FRACTIONS_OF_MAX[0]),
          hrZone2Max: Math.round(plausibleMaxHr * ZONE_FRACTIONS_OF_MAX[1]),
          hrZone3Max: Math.round(plausibleMaxHr * ZONE_FRACTIONS_OF_MAX[2]),
          hrZone4Max: Math.round(plausibleMaxHr * ZONE_FRACTIONS_OF_MAX[3]),
        }
      : null;

  return {
    windowDays: WINDOW_DAYS,
    ftpWatts: {
      current: user.ftpWatts,
      suggested: suggestedFtp,
      basis:
        suggestedFtp != null
          ? `95% of your best 20 minutes at ${Math.round(best20Power!)}W${
              curveBest ? ` (${monthYear(curveBest.on)})` : ''
            }, across ${powerRideCount} ride${powerRideCount === 1 ? '' : 's'} with power`
          : `No rides with usable power data in the last ${WINDOW_DAYS} days`,
    },
    thresholdPaceSecPerKm: {
      current: user.thresholdPaceSecPerKm,
      suggested: suggestedPace ?? fallbackPace,
      basis: paceBasis || `No runs long enough in the last ${WINDOW_DAYS} days`,
    },
    hrZones: {
      current: {
        hrZone1Max: user.hrZone1Max,
        hrZone2Max: user.hrZone2Max,
        hrZone3Max: user.hrZone3Max,
        hrZone4Max: user.hrZone4Max,
      },
      suggested: suggestedZones,
      basis:
        suggestedZones != null
          ? `Percent of your highest sustained heart rate (${Math.round(plausibleMaxHr!)} bpm) in the last ${WINDOW_DAYS} days`
          : `No usable heart-rate data in the last ${WINDOW_DAYS} days`,
    },
  };
}

function monthYear(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}
