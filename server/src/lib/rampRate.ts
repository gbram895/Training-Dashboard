import { computeFitnessSeries, type FitnessPoint } from './fitness.js';

/**
 * Is training load climbing faster than the body can absorb it?
 *
 * Everything here is read off the CTL/ATL curves lib/fitness.ts already
 * produces — there is deliberately no second load model. Two numbers come out
 * of them:
 *
 *  - **The acute:chronic workload ratio (ACWR)**, ATL / CTL. Fatigue divided by
 *    fitness: how the last week compares with what the athlete has been doing
 *    for months. Above 1, the recent week is harder than normal.
 *  - **Ramp rate**, how many CTL points fitness has gained in the last 7 days,
 *    and the average per week over the last 28. One big week and a sustained
 *    climb are different problems, so both are reported.
 *
 * Why the ratio matters when Form (TSB) already exists: they are the same
 * information, but the ratio is normalised by fitness. TSB is
 * `CTL - ATL`, so `ratio = 1 - TSB / CTL` — a Form of -20 on a CTL of 30 is a
 * ratio of 1.67 and genuinely alarming, while the same -20 on a CTL of 90 is
 * 1.22 and an ordinary hard week. The app's absolute Form bands cannot tell
 * those apart; this can.
 *
 * ## How strong is the evidence
 *
 * Weaker than the confident-looking numbers below suggest, and the UI says so.
 * The 0.8-1.3 "sweet spot" and the >1.5 danger zone come from Gabbett's
 * team-sport injury work. Later reanalyses (Impellizzeri and colleagues, among
 * others) found the association is much weaker than first reported and partly
 * an artefact of the method itself: acute load is *inside* chronic load, so the
 * two are mathematically coupled and correlate even in random data. Several
 * attempted replications did not reproduce the effect.
 *
 * On top of that, these thresholds were derived from 7-day and 28-day rolling
 * windows, and this app's chronic curve is a 42-day EWMA because that is what
 * the rest of the Performance Management Chart uses. A slower chronic baseline
 * lags a build more, so the same training reads a little higher here than it
 * would against a 28-day window. Changing CTL's time constant to match the
 * literature would move every Fitness and Form number in the app, which is a
 * far worse trade than accepting a slightly conservative ratio.
 *
 * So: this is a prompt to look at your week, not a diagnosis, and it is
 * labelled that way on the card rather than only in this comment.
 */

export type RampBand = 'UNKNOWN' | 'DETRAINING' | 'STEADY' | 'CLIMBING' | 'SPIKE';

/**
 * Conventional ACWR bands. Named rather than inlined because they are
 * assumptions, not measurements of this athlete — see the evidence note above
 * before tuning them.
 */
export const RATIO_DETRAINING = 0.8;
export const RATIO_CLIMBING = 1.3;
export const RATIO_SPIKE = 1.5;

/**
 * Ramp rate in CTL points per week. The usual coaching rule of thumb is that
 * more than ~5-8 a week sustained is more than most athletes absorb; it has
 * even less of an evidence base than the ratio does and is here because "load
 * is climbing too fast" is literally a question about this number.
 */
const RAMP_FAST = 5;
const RAMP_VERY_FAST = 8;

/**
 * Below this chronic load the ratio is division by a small number: one hard
 * session off a CTL of 6 gives a ratio of 3 and means nothing. The status is
 * withheld rather than shown with a caveat, the same way lib/calibration.ts
 * withholds an implausible suggestion instead of clamping it.
 */
export const MIN_CHRONIC_CTL = 15;

/**
 * CTL starts at zero on the athlete's first workout and takes about its own
 * time constant to settle, so a young history reads as a permanent spike.
 * Shorter than this and the ratio is still reported, but flagged as provisional.
 */
const CHRONIC_SPIN_UP_DAYS = 42;

export const RAMP_WINDOW_DAYS = 7;
const RAMP_AVERAGE_DAYS = 28;

export interface RampStatus {
  band: RampBand;
  /** ATL / CTL, rounded to 2dp. Null when chronic load is too small to divide by. */
  ratio: number | null;
  ctl: number;
  atl: number;
  /** CTL points gained over the last 7 days. Null until there are 7 days of curve. */
  rampPerWeek: number | null;
  /** CTL points gained per week, averaged over the last 28 days. */
  rampPerWeekAvg: number | null;
  /** One line, plain language, safe to show on its own. */
  headline: string;
  /** A sentence of what that means and what to do about it. */
  detail: string;
  /** Days of fitness curve behind this (capped at the 180 the series returns). */
  historyDays: number;
  /** True while the chronic curve is still spinning up and reads artificially low. */
  provisional: boolean;
}

function bandFromRatio(ratio: number): RampBand {
  if (ratio > RATIO_SPIKE) return 'SPIKE';
  if (ratio > RATIO_CLIMBING) return 'CLIMBING';
  if (ratio < RATIO_DETRAINING) return 'DETRAINING';
  return 'STEADY';
}

function bandFromRamp(rampPerWeek: number): RampBand {
  if (rampPerWeek > RAMP_VERY_FAST) return 'SPIKE';
  if (rampPerWeek > RAMP_FAST) return 'CLIMBING';
  return 'STEADY';
}

const SEVERITY: Record<RampBand, number> = {
  UNKNOWN: -1,
  DETRAINING: 0,
  STEADY: 1,
  CLIMBING: 2,
  SPIKE: 3,
};

export interface RampInputs {
  ctl: number;
  atl: number;
  /** CTL seven days earlier, or null when there is not that much curve behind it. */
  ctlWeekAgo: number | null;
}

export interface RampVerdict {
  band: RampBand;
  /** ATL / CTL. Null when chronic load is too small to divide by. */
  ratio: number | null;
  /** CTL points gained over the last 7 days. */
  rampPerWeek: number | null;
}

/**
 * The single definition of how fast is too fast, shared by the dashboard card
 * and the plan generator. They had better agree: a card calling the week a
 * spike while the plan cheerfully schedules VO2max intervals is worse than
 * either signal on its own.
 *
 * The worse of the two signals wins. A ratio inside the sweet spot while CTL
 * climbs 10 points a week is still a fast build, and the ratio alone will never
 * catch that, because acute and chronic load rise together.
 *
 * The ramp can only ever escalate, never soften: a rest week has a low ratio
 * AND a falling CTL, and a "steady" ramp reading must not overwrite the ratio's
 * "you have eased off" with a flat all-clear.
 */
export function judgeRamp({ ctl, atl, ctlWeekAgo }: RampInputs): RampVerdict {
  const rampPerWeek = ctlWeekAgo != null ? Math.round((ctl - ctlWeekAgo) * 10) / 10 : null;
  if (ctl < MIN_CHRONIC_CTL) return { band: 'UNKNOWN', ratio: null, rampPerWeek };

  const ratio = atl / ctl;
  const ratioBand = bandFromRatio(ratio);
  const rampBand = rampPerWeek != null ? bandFromRamp(rampPerWeek) : 'STEADY';
  const escalates = SEVERITY[rampBand] > SEVERITY.STEADY && SEVERITY[rampBand] > SEVERITY[ratioBand];
  return { band: escalates ? rampBand : ratioBand, ratio, rampPerWeek };
}

function percentOverNormal(ratio: number): number {
  return Math.round(Math.abs(ratio - 1) * 100);
}

function ctlDaysAgo(series: FitnessPoint[], days: number): number | null {
  const index = series.length - 1 - days;
  return index >= 0 ? series[index].ctl : null;
}

/**
 * Judges the ramp from a fitness series. Pure, so the plan generator and the
 * dashboard both read the same numbers rather than each forming an opinion.
 */
export function assessRamp(series: FitnessPoint[]): RampStatus | null {
  if (series.length === 0) return null;

  const today = series[series.length - 1];
  const historyDays = series.length;
  const provisional = historyDays < CHRONIC_SPIN_UP_DAYS;

  const monthAgoCtl = ctlDaysAgo(series, RAMP_AVERAGE_DAYS);
  const rampPerWeekAvg =
    monthAgoCtl != null
      ? Math.round(((today.ctl - monthAgoCtl) / (RAMP_AVERAGE_DAYS / 7)) * 10) / 10
      : null;

  const { band, ratio, rampPerWeek } = judgeRamp({
    ctl: today.ctl,
    atl: today.atl,
    ctlWeekAgo: ctlDaysAgo(series, RAMP_WINDOW_DAYS),
  });

  // The only band with no ratio behind it — everything below this line can
  // rely on there being one.
  if (band === 'UNKNOWN' || ratio == null) {
    return {
      band: 'UNKNOWN',
      ratio: null,
      ctl: today.ctl,
      atl: today.atl,
      rampPerWeek,
      rampPerWeekAvg,
      headline: 'Not enough steady training behind you to judge this yet',
      detail:
        `This compares your last week against your longer-term load, and that longer-term load ` +
        `(Fitness ${today.ctl}) is still too low to divide by — one hard session would read as a ` +
        `spike. It will start reporting once training has been regular for a few weeks.`,
      historyDays,
      provisional,
    };
  }

  const over = percentOverNormal(ratio);
  const rampPhrase =
    rampPerWeek == null
      ? ''
      : rampPerWeek >= 0
        ? ` Fitness is up ${rampPerWeek} points in the last week`
        : ` Fitness is down ${Math.abs(rampPerWeek)} points in the last week`;

  let headline: string;
  let detail: string;
  switch (band) {
    case 'SPIKE':
      headline = 'Your load has jumped sharply';
      detail =
        `The last week is about ${over}% harder than the load you have been carrying for the last ` +
        `month or two.` +
        `${rampPhrase}. This is the point where most people pick up a niggle — an easy few days ` +
        `now costs less than a fortnight off later.`;
      break;
    case 'CLIMBING':
      headline = 'Load is climbing fast';
      detail =
        `The last week is about ${over}% above your recent normal.${rampPhrase}. That is a real ` +
        `build rather than a red flag, but it is the top of the range worth holding — keep the ` +
        `easy days genuinely easy.`;
      break;
    case 'DETRAINING':
      headline = 'Load has dropped off';
      detail =
        `The last week is about ${over}% below your recent normal.${rampPhrase}. Fine if you are ` +
        `tapering or recovering; if it was not deliberate, fitness will start coming off.`;
      break;
    default:
      headline = 'Load is steady';
      detail = `The last week is in line with what you have been doing.${rampPhrase}.`;
      break;
  }

  if (provisional) {
    detail +=
      ` Treat this as provisional — there are only ${historyDays} days of training history here, ` +
      `and the long-term curve reads low until it has had about six weeks to settle, which ` +
      `pushes the ratio up.`;
  }

  return {
    band,
    ratio: Math.round(ratio * 100) / 100,
    ctl: today.ctl,
    atl: today.atl,
    rampPerWeek,
    rampPerWeekAvg,
    headline,
    detail,
    historyDays,
    provisional,
  };
}

export async function getRampStatus(userId: string): Promise<RampStatus | null> {
  return assessRamp(await computeFitnessSeries(userId));
}
