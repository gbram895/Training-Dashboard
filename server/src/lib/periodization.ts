import type { TrainingTarget, TargetPriority } from '@prisma/client';
import { prisma } from './prisma.js';
import { projectFtp, projectThresholdPace, type ThresholdTrends } from './thresholdTrend.js';
import { goalKindLabel, profileFor } from './goalSpecificity.js';

/**
 * Turns "these are the things I'm doing this year" into a load trajectory.
 *
 * Without a goal the plan is purely reactive: the standing weekly hours never
 * move, and the only thing that ever changes a day is fatigue making it easier.
 * That keeps an athlete exactly as fit as they already are. With goals, each
 * day's hours get scaled by a multiplier that ramps week over week, drops every
 * Nth week for recovery, tapers into each event and eases off after it.
 *
 * The whole list is periodised together rather than one goal at a time, which
 * is the difference between a season and a series of unrelated training blocks:
 *
 *  - One goal is the season's ANCHOR — the next A-priority goal still ahead
 *    (see pickAnchor). The ramp aims there and only there, so a club race in
 *    three weeks never quietly becomes the thing the whole year is built around.
 *  - EVERY goal still ahead gets a say over any given day, and the smallest
 *    multiplier wins. A day inside two goals' taper windows takes the deeper
 *    taper; a day two days after a race is a recovery day even if the anchor's
 *    build says otherwise.
 *  - How much a goal is allowed to bend the season is its priority: an A goal
 *    gets its full taper and a real recovery block afterwards, a B goal gets a
 *    short sharpening taper and a day or two, and a C goal is trained through.
 *  - Weeks that are spoken for by someone else's taper or recovery don't count
 *    as build weeks toward the anchor, so the ramp knows it has less runway
 *    than the calendar suggests and doesn't promise fitness it can't deliver.
 *
 * The ramp is anchored to the athlete's CURRENT fitness every time the plan
 * regenerates, not to a schedule laid down when the goal was created. Miss a
 * week and the plan rebuilds from where you actually are rather than demanding
 * you make up the difference — which is the failure mode of every static plan.
 */

export type Phase = 'BUILD' | 'RECOVERY' | 'TAPER' | 'EVENT' | 'POST_RACE';

export interface DayPeriodization {
  phase: Phase;
  /** 1-based week of the plan, counted from the season start. */
  phaseWeek: number;
  /** Scales that weekday's standing hours from TrainingPlanConfig. */
  loadMultiplier: number;
  /** Days to the next goal still ahead — the one this day is pointed at. */
  daysToEvent: number;
  /** The goal that decided this day's phase: the one tapering, racing or being recovered from. */
  targetId: string;
  targetName: string;
  targetPriority: TargetPriority;
}

// Raising CTL by R points in a week needs daily TSS of about CTL + 6.5R: a
// week of constant daily load d moves CTL by (d - CTL) * (1 - e^(-7/42)), and
// 1 / (1 - e^(-1/6)) is 6.51. Falls out of the same EWMA lib/fitness.ts uses.
const DAILY_TSS_PER_CTL_POINT = 6.51;

// However far the maths says to go, a week is never allowed to be less than
// half or more than 1.5x the athlete's standing hours. A plan that doubles
// someone's week is how people get hurt, and one that halves it for weeks on
// end is a bug, not a taper.
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 1.5;

// Used only when there's no history to measure against — roughly a steady
// endurance hour.
const DEFAULT_TSS_PER_HOUR = 55;
const TSS_PER_HOUR_WINDOW_DAYS = 28;

// With no explicit ceiling, the build tops out at the fitness the athlete's own
// standing weekly hours can hold, plus a modest stretch. Without this the ramp
// asks for more every week forever, pins against MAX_MULTIPLIER a month out and
// then flatlines there — which is neither achievable nor a plan.
const SUSTAINABLE_STRETCH = 1.15;

// A taper eases down from a normal week, never from the biggest week of the
// block — starting one at 150% of the athlete's usual hours is not a taper.
const TAPER_CEILING = 1;

/**
 * What each priority tier is allowed to do to the days around it.
 *
 * `taperScale` shortens the goal's own configured taper: a B goal sharpens for
 * a few days rather than running the full pre-race taper, and a C goal is
 * trained straight through. `recoveryDays` is how long afterwards stays easy,
 * which is the other half of "two goals close together" — a hard event leaves
 * a hole whether or not the next one is soon.
 */
const PRIORITY_RULES: Record<TargetPriority, { taperScale: number; recoveryDays: number; recoveryFloor: number }> = {
  // Peak for it, then take the better part of a week to come back.
  A: { taperScale: 1, recoveryDays: 5, recoveryFloor: 0.5 },
  // Arrive fresh-ish, lose a couple of days.
  B: { taperScale: 0.4, recoveryDays: 2, recoveryFloor: 0.6 },
  // On the calendar, but the training week around it doesn't move.
  C: { taperScale: 0, recoveryDays: 0, recoveryFloor: 1 },
};

// Two A goals closer together than this can't both be peaked for — there isn't
// room for a taper, a race, recovery and a rebuild in between. The plan peaks
// for the first and the second rides that peak; findGoalConflicts says so
// rather than leaving the athlete to work it out from the numbers.
export const MIN_DAYS_BETWEEN_A_GOALS = 21;

export interface PeriodizationContext {
  /** Every goal the athlete has, past ones included — periodizeDay ignores what's behind. */
  targets: TrainingTarget[];
  /** The athlete's real CTL right now, from lib/fitness.ts. */
  currentCtl: number;
  /** The athlete's real ATL right now — only used to seed the Form (TSB)
   * projection in forecastGoals; the ramp itself never reads it. Defaults to
   * currentCtl (Form 0) when unknown. */
  currentAtl?: number;
  /** Measured from their own recent training — see measureTssPerHour. */
  tssPerHour: number;
  /** Standing weekly hours from TrainingPlanConfig. */
  weeklyHours: number;
}

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((utcMidnight(to).getTime() - utcMidnight(from).getTime()) / 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * How much training stress this athlete actually accumulates per hour of
 * training. Deriving it rather than assuming a constant is what lets the
 * multiplier mean the same thing for a 200 TSS/week rider and a 600 one.
 */
export async function measureTssPerHour(userId: string): Promise<number> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - TSS_PER_HOUR_WINDOW_DAYS);
  const workouts = await prisma.workout.findMany({
    where: { userId, date: { gte: since }, tss: { not: null } },
    select: { tss: true, durationMin: true },
  });

  const totalTss = workouts.reduce((sum, w) => sum + (w.tss ?? 0), 0);
  const totalHours = workouts.reduce((sum, w) => sum + w.durationMin / 60, 0);
  if (totalHours < 1) return DEFAULT_TSS_PER_HOUR;
  return totalTss / totalHours;
}

/** How many days before its date a goal's taper starts, given its priority. */
export function effectiveTaperDays(target: TrainingTarget): number {
  return Math.round(target.taperDays * PRIORITY_RULES[target.priority].taperScale);
}

/**
 * The season's week 1. Goals share one anchor — the earliest startedOn — so
 * adding a September goal in the middle of building toward a June one doesn't
 * restart the athlete's week count or resynchronise their recovery weeks.
 */
export function seasonStart(targets: TrainingTarget[]): Date {
  const earliest = targets.reduce<Date | null>(
    (best, t) => (best == null || t.startedOn < best ? t.startedOn : best),
    null,
  );
  return utcMidnight(earliest ?? new Date());
}

/**
 * The goal the ramp is aimed at: the next A goal still ahead, or — when there
 * are none left — the last goal of any priority, so a season of nothing but
 * club races still builds toward its final one rather than drifting.
 */
export function pickAnchor(targets: TrainingTarget[], from: Date): TrainingTarget | null {
  const ahead = targets
    .filter((t) => daysBetween(from, t.date) >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (ahead.length === 0) return null;
  return ahead.find((t) => t.priority === 'A') ?? ahead[ahead.length - 1];
}

/** The next goal on or after `day`, whatever its priority — what the day counts down to. */
function nextTarget(targets: TrainingTarget[], day: Date): TrainingTarget | null {
  let best: TrainingTarget | null = null;
  for (const t of targets) {
    if (daysBetween(day, t.date) < 0) continue;
    if (best == null || t.date < best.date) best = t;
  }
  return best;
}

/**
 * What one goal wants a given day to be, or null if that goal has no opinion
 * about it (too far out, or already recovered from). Every goal ahead gets
 * asked, and resolveDay takes the most conservative answer.
 */
interface TargetClaim {
  target: TrainingTarget;
  phase: Exclude<Phase, 'BUILD' | 'RECOVERY'>;
  /** A multiplier, or a cap applied to whatever the build wanted (taper). */
  multiplier: number;
  daysToEvent: number;
}

function claimFor(target: TrainingTarget, day: Date, buildMultiplier: number): TargetClaim | null {
  const daysToEvent = daysBetween(day, target.date);
  const rules = PRIORITY_RULES[target.priority];

  if (daysToEvent === 0) {
    // Race day isn't the plan's to fill in, whatever its priority.
    return { target, phase: 'EVENT', multiplier: 0, daysToEvent };
  }

  if (daysToEvent > 0) {
    const taperDays = effectiveTaperDays(target);
    if (taperDays <= 0 || daysToEvent > taperDays) return null;
    // Ease down from wherever the build had got to, capped at a normal week —
    // a taper from a modest block and one from a big block shouldn't land on
    // the same number, but neither should start above the athlete's usual load.
    const atTaperStart = clamp(buildMultiplier, MIN_MULTIPLIER, TAPER_CEILING);
    const progress = daysToEvent / taperDays; // 1 at the start, ~0 at the event
    const multiplier = target.taperFloor + (atTaperStart - target.taperFloor) * progress;
    return { target, phase: 'TAPER', multiplier: clamp(multiplier, target.taperFloor, MAX_MULTIPLIER), daysToEvent };
  }

  // Behind us: the days an event leaves flat afterwards.
  const daysSince = -daysToEvent;
  if (rules.recoveryDays <= 0 || daysSince > rules.recoveryDays) return null;
  // Easiest on day one and climbing back to normal, rather than a cliff edge
  // back to full training the morning after the recovery window ends.
  const progress = (daysSince - 1) / Math.max(1, rules.recoveryDays);
  const multiplier = rules.recoveryFloor + (1 - rules.recoveryFloor) * progress;
  return { target, phase: 'POST_RACE', multiplier: clamp(multiplier, rules.recoveryFloor, 1), daysToEvent };
}

/**
 * The un-tapered, un-recovery-adjusted multiplier for a given week: how much
 * bigger (or smaller) that week needs to be than the standing weekly hours for
 * CTL to be on its ramp by then. Read off the anchor goal only.
 */
function rampMultiplier(ctx: PeriodizationContext, anchor: TrainingTarget, buildWeeksAhead: number): number {
  const { currentCtl, tssPerHour, weeklyHours } = ctx;

  const baselineDailyTss = (weeklyHours * tssPerHour) / 7;
  if (baselineDailyTss <= 0) return 1;

  // CTL settles at whatever the average daily load is, so the athlete's own
  // weekly hours already say what fitness they can hold.
  const ceiling = anchor.peakCtl ?? baselineDailyTss * SUSTAINABLE_STRETCH;
  const desiredCtl = Math.min(ceiling, currentCtl + anchor.rampPerWeek * buildWeeksAhead);

  // Once the ceiling is reached the job is to hold it, which needs daily load
  // equal to CTL rather than above it.
  const atPeak = desiredCtl >= ceiling;
  const requiredDailyTss = desiredCtl + (atPeak ? 0 : anchor.rampPerWeek * DAILY_TSS_PER_CTL_POINT);

  return requiredDailyTss / baselineDailyTss;
}

/**
 * Build weeks between two week indices: the ones that are neither a scheduled
 * recovery week nor already spoken for by some goal's taper, race or recovery.
 *
 * This is what stops the ramp over-promising. Three club races between here and
 * the A goal cost real build time, and a plan that counts those weeks as build
 * weeks will keep asking for a fitness it has no way to reach, pin against
 * MAX_MULTIPLIER, and hand the athlete a block they can't complete.
 */
function countBuildWeeks(
  ctx: PeriodizationContext,
  anchor: TrainingTarget,
  start: Date,
  fromWeek: number,
  toWeek: number,
): number {
  if (toWeek <= fromWeek) return 0;
  let count = 0;
  for (let w = fromWeek + 1; w <= toWeek; w++) {
    if (anchor.recoveryEveryNWeeks > 0 && w % anchor.recoveryEveryNWeeks === 0) continue;
    // Judge the week by its midpoint — a Thursday is a fair stand-in for
    // whether a week is a training week or a race week.
    const midweek = new Date(start);
    midweek.setUTCDate(midweek.getUTCDate() + (w - 1) * 7 + 3);
    const claimed = ctx.targets.some((t) => claimFor(t, midweek, 1) != null);
    if (claimed) continue;
    count++;
  }
  return count;
}

/**
 * Where a given date sits in the season, and what that does to its hours.
 * Returns null once every goal is in the past — the goals stop influencing
 * anything rather than silently going on forever.
 */
export function periodizeDay(date: Date, today: Date, ctx: PeriodizationContext): DayPeriodization | null {
  const day = utcMidnight(date);
  const upcoming = nextTarget(ctx.targets, day);
  const anchor = pickAnchor(ctx.targets, day);

  // Everything is behind us — except that the days right after a race still
  // belong to it, so a goal that has just happened keeps its say.
  if (!upcoming || !anchor) {
    const trailing = ctx.targets
      .map((t) => claimFor(t, day, 1))
      .filter((c): c is TargetClaim => c != null)
      .sort((a, b) => a.multiplier - b.multiplier)[0];
    if (!trailing) return null;
    const start = seasonStart(ctx.targets);
    return {
      phase: trailing.phase,
      phaseWeek: Math.max(1, Math.floor(daysBetween(start, day) / 7) + 1),
      loadMultiplier: trailing.multiplier,
      daysToEvent: trailing.daysToEvent,
      targetId: trailing.target.id,
      targetName: trailing.target.name,
      targetPriority: trailing.target.priority,
    };
  }

  const start = seasonStart(ctx.targets);
  const weekOf = (d: Date) => Math.max(1, Math.floor(daysBetween(start, d) / 7) + 1);
  const phaseWeek = weekOf(day);
  const buildWeeksAhead = countBuildWeeks(ctx, anchor, start, weekOf(today), phaseWeek);

  const isRecoveryWeek = anchor.recoveryEveryNWeeks > 0 && phaseWeek % anchor.recoveryEveryNWeeks === 0;
  const ramp = rampMultiplier(ctx, anchor, buildWeeksAhead);
  const buildMultiplier =
    clamp(ramp, MIN_MULTIPLIER, MAX_MULTIPLIER) * (isRecoveryWeek ? anchor.recoveryMultiplier : 1);

  // Every goal gets a say on this day, and the quietest day wins: a day caught
  // between one race's taper and another's recovery should be the easier of
  // the two, never the average and never the louder one.
  const claims = ctx.targets
    .map((t) => claimFor(t, day, buildMultiplier))
    .filter((c): c is TargetClaim => c != null);
  // Race day outranks everything, even a deeper taper for a bigger goal later.
  const winner =
    claims.find((c) => c.phase === 'EVENT') ??
    claims.sort((a, b) => a.multiplier - b.multiplier)[0];

  if (winner && winner.multiplier <= buildMultiplier) {
    return {
      phase: winner.phase,
      phaseWeek,
      loadMultiplier: clamp(winner.multiplier, 0, MAX_MULTIPLIER),
      daysToEvent: daysBetween(day, upcoming.date),
      targetId: winner.target.id,
      targetName: winner.target.name,
      targetPriority: winner.target.priority,
    };
  }

  return {
    phase: isRecoveryWeek ? 'RECOVERY' : 'BUILD',
    phaseWeek,
    loadMultiplier: clamp(buildMultiplier, MIN_MULTIPLIER, MAX_MULTIPLIER),
    daysToEvent: daysBetween(day, upcoming.date),
    targetId: anchor.id,
    targetName: anchor.name,
    targetPriority: anchor.priority,
  };
}

export function describePhase(p: DayPeriodization): string {
  switch (p.phase) {
    case 'EVENT':
      return p.targetName;
    case 'TAPER':
      return `Taper — ${p.daysToEvent} day${p.daysToEvent === 1 ? '' : 's'} to ${p.targetName}`;
    case 'POST_RACE':
      return `Easy after ${p.targetName}`;
    case 'RECOVERY':
      return `Recovery week — week ${p.phaseWeek}`;
    case 'BUILD':
      return `Build week ${p.phaseWeek}`;
  }
}

/**
 * Where the athlete's goals are asking for something the calendar can't give,
 * said plainly enough to act on. Surfaced on the Plan tab rather than silently
 * resolved, because the fix is a decision only they can make: drop one, move
 * one, or accept that one of them is a training day.
 */
export interface ConflictConfig {
  includeRunning: boolean;
}

export function findGoalConflicts(
  targets: TrainingTarget[],
  from: Date,
  config?: ConflictConfig | null,
): string[] {
  const ahead = targets
    .filter((t) => daysBetween(from, t.date) >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const warnings: string[] = [];

  const aGoals = ahead.filter((t) => t.priority === 'A');
  for (let i = 1; i < aGoals.length; i++) {
    const gap = daysBetween(aGoals[i - 1].date, aGoals[i].date);
    if (gap < MIN_DAYS_BETWEEN_A_GOALS) {
      warnings.push(
        `${aGoals[i - 1].name} and ${aGoals[i].name} are ${gap} day${gap === 1 ? '' : 's'} apart — ` +
          `there isn't room to build, peak and recover twice. The plan peaks for ${aGoals[i - 1].name}, ` +
          `and ${aGoals[i].name} comes off that same peak: recovery and a short sharpening rather than a block of its own. ` +
          `Make ${aGoals[i - 1].name} a B goal if ${aGoals[i].name} is the one that matters.`,
      );
    }
  }

  // A run of events with no clear build in between is the other way a season
  // quietly stops working: every week is a taper or a recovery, and fitness
  // slides all year.
  for (let i = 1; i < ahead.length; i++) {
    const gap = daysBetween(ahead[i - 1].date, ahead[i].date);
    const recovery = PRIORITY_RULES[ahead[i - 1].priority].recoveryDays;
    const taper = effectiveTaperDays(ahead[i]);
    if (gap > 0 && gap <= recovery + taper) {
      warnings.push(
        `There's no real training between ${ahead[i - 1].name} and ${ahead[i].name} — ` +
          `${gap} day${gap === 1 ? '' : 's'} is recovery and taper back to back. That's fine for a block of racing, ` +
          `but you won't gain fitness across it.`,
      );
    }
  }

  // A running goal with running switched off is the plan being asked for
  // something it has been told not to do. Resolving it quietly either way —
  // planning runs they said they don't want, or training a run goal entirely
  // on the bike — would be worse than saying so.
  if (config && !config.includeRunning) {
    const runGoals = ahead.filter((t) => {
      const profile = profileFor(t.kind);
      return profile != null && (profile.sport === 'RUN' || profile.sport === 'BOTH');
    });
    for (const goal of runGoals) {
      warnings.push(
        `${goal.name} is a ${goalKindLabel(goal.kind).toLowerCase()}, but running is switched off in your plan ` +
          `settings — so every session is being planned on the bike. Turn running on (and set which days are runs) ` +
          `to get the sessions that actually prepare you for it.`,
      );
    }
  }

  return warnings;
}

/**
 * A week-by-week look at the whole season: what each week is for, and where
 * fitness is projected to be by the end of it.
 *
 * The rolling plan window is a fortnight, so without this the athlete can set
 * goals ten months out and see nothing that tells them the plan has taken them
 * into account. This is projected, not promised — it re-derives from real
 * fitness on every call, exactly like the plan itself.
 */
export interface SeasonWeek {
  weekStart: string; // YYYY-MM-DD
  phase: Phase;
  phaseWeek: number;
  /** Mean of the week's daily multipliers. */
  loadMultiplier: number;
  projectedCtl: number;
  /** Goals falling in this week. */
  events: { id: string; name: string; date: string; priority: TargetPriority }[];
}

const CTL_DECAY = 1 - Math.exp(-1 / 42);
const ATL_DECAY = 1 - Math.exp(-1 / 7);

function dateKey(d: Date): string {
  return utcMidnight(d).toISOString().slice(0, 10);
}

/**
 * One day of the forward projection: the plan the athlete is on, walked into
 * the future the same way lib/fitness.ts walks it into the past. Fitness (CTL)
 * and Fatigue (ATL) are both carried across the whole horizon so that both the
 * season chart and the per-goal forecast read off ONE projection rather than
 * two that could drift apart.
 *
 * `ctlStart`/`atlStart` are the values going INTO the day, before its own load
 * is folded in — which is the freshness the athlete would carry to a race that
 * morning, and matches the "going into that day" TSB convention in fitness.ts.
 */
interface ProjectedDay {
  day: Date;
  periodization: DayPeriodization | null;
  multiplier: number;
  ctlStart: number;
  atlStart: number;
  ctlEnd: number;
  atlEnd: number;
}

/**
 * Walk the same day-by-day CTL/ATL projection the plan itself runs, re-anchoring
 * the ramp to the projected fitness each day exactly as generatePlanWindow does
 * nightly. This is projected, not promised: it re-derives from real current
 * fitness on every call, so a missed week shows up here next time rather than
 * being made up.
 */
function walkProjection(ctx: PeriodizationContext, today: Date, totalDays: number): ProjectedDay[] {
  const dailyTssBaseline = (ctx.weeklyHours * ctx.tssPerHour) / 7;
  let ctl = ctx.currentCtl;
  let atl = ctx.currentAtl ?? ctx.currentCtl;

  const days: ProjectedDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(utcMidnight(today));
    day.setUTCDate(day.getUTCDate() + i);

    const periodization = periodizeDay(day, day, { ...ctx, currentCtl: ctl });
    const multiplier = periodization?.loadMultiplier ?? 1;
    const dayTss = dailyTssBaseline * multiplier;

    const ctlStart = ctl;
    const atlStart = atl;
    ctl = ctl + (dayTss - ctl) * CTL_DECAY;
    atl = atl + (dayTss - atl) * ATL_DECAY;

    days.push({ day, periodization, multiplier, ctlStart, atlStart, ctlEnd: ctl, atlEnd: atl });
  }
  return days;
}

/** How many days of projection reach the last goal, plus a trailing week. */
function projectionHorizon(ahead: TrainingTarget[], today: Date, maxWeeks: number): number {
  const lastDate = ahead.reduce((latest, t) => (t.date > latest ? t.date : latest), ahead[0].date);
  return Math.min(maxWeeks * 7, daysBetween(today, lastDate) + 7);
}

export function projectSeason(ctx: PeriodizationContext, today: Date, maxWeeks = 60): SeasonWeek[] {
  const ahead = ctx.targets.filter((t) => daysBetween(today, t.date) >= 0);
  if (ahead.length === 0) return [];

  const days = walkProjection(ctx, today, projectionHorizon(ahead, today, maxWeeks));

  const weeks: SeasonWeek[] = [];
  for (let w = 0; w * 7 < days.length; w++) {
    const chunk = days.slice(w * 7, w * 7 + 7);
    const weekStart = chunk[0].day;
    const firstPeriodized = chunk.find((d) => d.periodization != null)?.periodization ?? null;
    const events = ahead
      .filter((t) => {
        const offset = daysBetween(weekStart, t.date);
        return offset >= 0 && offset < 7;
      })
      .map((t) => ({ id: t.id, name: t.name, date: dateKey(t.date), priority: t.priority }));
    const mean = chunk.reduce((a, d) => a + d.multiplier, 0) / chunk.length;
    weeks.push({
      weekStart: dateKey(weekStart),
      phase: dominantPhase(chunk.map((d) => d.periodization?.phase ?? 'BUILD')),
      phaseWeek: firstPeriodized?.phaseWeek ?? 1,
      loadMultiplier: Math.round(mean * 100) / 100,
      // The week's fitness is where the projection has got to by its last day.
      projectedCtl: Math.round(chunk[chunk.length - 1].ctlEnd * 10) / 10,
      events,
    });
  }

  return weeks;
}

/** How fresh the athlete is projected to be on the day, from the projected TSB. */
export type Freshness = 'fresh' | 'neutral' | 'fatigued';

// TrainingPeaks-style Form bands: comfortably positive is tapered and race-ready,
// deeply negative is buried under fatigue, and the grey zone between is neither.
function freshnessOf(tsb: number): Freshness {
  if (tsb > 5) return 'fresh';
  if (tsb < -10) return 'fatigued';
  return 'neutral';
}

/**
 * The answer to "how fit will I be for each of my goals". For every goal still
 * ahead, this samples the one shared projection on the goal's own date and
 * reports the fitness (CTL) and freshness (Form/TSB) the athlete is on course
 * to bring to it — the number the season chart draws, made explicit per goal.
 *
 * peakCtl is a target only the anchor is actually built toward (a B or C goal's
 * ceiling never reshapes the ramp — see rampMultiplier), so `meetsPeak` is only
 * reported for the anchor. For every other goal the projected fitness is simply
 * whatever the anchor-driven build has the athlete at on that date.
 */
export interface GoalForecast {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  priority: TargetPriority;
  daysAway: number;
  isAnchor: boolean;
  /** Projected Fitness (CTL) carried into the goal's day. */
  projectedCtl: number;
  /** Change in fitness from now to the goal. */
  ctlDelta: number;
  /** Projected Form (TSB) on the day — freshness, what the taper is for. */
  projectedTsb: number;
  freshness: Freshness;
  /** The anchor's fitness target, if it set one; null for every other goal. */
  peakCtl: number | null;
  /** Whether the projection reaches that target; null when there is no target. */
  meetsPeak: boolean | null;
  /**
   * Build weeks between now and the goal — taper, race and recovery days
   * excluded, since those don't raise a threshold. What the FTP and pace
   * projections below are carried over.
   */
  buildWeeks: number;
  /** Projected FTP on the day, or null when there isn't enough to measure a trend from. */
  projectedFtpWatts: number | null;
  /** Projected threshold pace in seconds per km, or null for the same reason. */
  projectedThresholdPaceSecPerKm: number | null;
}

export interface FitnessForecast {
  currentCtl: number;
  goals: GoalForecast[];
  /** The athlete's configured thresholds, which the projections start from. */
  currentFtpWatts: number | null;
  currentThresholdPaceSecPerKm: number | null;
  /** What the FTP/pace trend was measured from, or why there is no projection. */
  ftpBasis: string;
  paceBasis: string;
}

export function forecastGoals(
  ctx: PeriodizationContext,
  today: Date,
  trends?: ThresholdTrends,
  maxWeeks = 60,
): FitnessForecast {
  const currentCtl = Math.round(ctx.currentCtl * 10) / 10;
  const thresholds = {
    currentFtpWatts: trends?.ftp?.current ?? null,
    currentThresholdPaceSecPerKm: trends?.pace?.current ?? null,
    ftpBasis: trends?.ftpBasis ?? 'Not measured',
    paceBasis: trends?.paceBasis ?? 'Not measured',
  };
  const ahead = ctx.targets
    .filter((t) => daysBetween(today, t.date) >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (ahead.length === 0) return { currentCtl, goals: [], ...thresholds };

  const days = walkProjection(ctx, today, projectionHorizon(ahead, today, maxWeeks));
  const byDate = new Map(days.map((d) => [dateKey(d.day), d]));
  const anchor = pickAnchor(ctx.targets, today);

  // Fitness for a race day is what you carry INTO it, so the last projected day
  // before the goal stands in when the goal itself falls past the horizon.
  const lastDay = days[days.length - 1];

  // Only BUILD days raise a threshold: a fortnight of tapering for an earlier
  // race is time the athlete does not get back as fitness.
  const buildDaysBefore = (goalDate: Date) =>
    days.filter((d) => d.day < utcMidnight(goalDate) && d.periodization?.phase === 'BUILD').length;

  const goals: GoalForecast[] = ahead.map((t) => {
    const point = byDate.get(dateKey(t.date)) ?? lastDay;
    const buildWeeks = Math.round((buildDaysBefore(t.date) / 7) * 10) / 10;
    const projectedCtl = Math.round(point.ctlStart * 10) / 10;
    const projectedTsb = Math.round((point.ctlStart - point.atlStart) * 10) / 10;
    const isAnchor = anchor?.id === t.id;
    const peakCtl = isAnchor && t.peakCtl != null ? t.peakCtl : null;
    return {
      id: t.id,
      name: t.name,
      date: dateKey(t.date),
      priority: t.priority,
      daysAway: daysBetween(today, t.date),
      isAnchor,
      projectedCtl,
      ctlDelta: Math.round((projectedCtl - currentCtl) * 10) / 10,
      projectedTsb,
      freshness: freshnessOf(projectedTsb),
      peakCtl,
      // A point or two short of a target isn't a miss worth flagging.
      meetsPeak: peakCtl != null ? projectedCtl >= peakCtl - 2 : null,
      buildWeeks,
      projectedFtpWatts: trends?.ftp ? projectFtp(trends.ftp, buildWeeks) : null,
      projectedThresholdPaceSecPerKm: trends?.pace ? projectThresholdPace(trends.pace, buildWeeks) : null,
    };
  });

  return { currentCtl, goals, ...thresholds };
}

/**
 * What to call a week that isn't all one thing. A week containing a race is a
 * race week whatever else is in it; otherwise the week is whatever most of its
 * days are, so a block that turns into a taper on Friday still reads as a
 * build week.
 */
function dominantPhase(phases: Phase[]): Phase {
  if (phases.includes('EVENT')) return 'EVENT';
  const counts = new Map<Phase, number>();
  for (const p of phases) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: Phase = 'BUILD';
  let bestCount = -1;
  for (const [phase, count] of counts) {
    if (count > bestCount) {
      best = phase;
      bestCount = count;
    }
  }
  return best;
}
