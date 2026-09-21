import type { TrainingTarget } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Turns "I'm doing X on this date" into a load trajectory.
 *
 * Without a target the plan is purely reactive: the standing weekly hours never
 * move, and the only thing that ever changes a day is fatigue making it easier.
 * That keeps an athlete exactly as fit as they already are. With a target, each
 * day's hours get scaled by a multiplier that ramps week over week toward the
 * event, drops every Nth week for recovery, and tapers over the final stretch.
 *
 * The ramp is anchored to the athlete's CURRENT fitness every time the plan
 * regenerates, not to a schedule laid down when the target was created. Miss a
 * week and the plan rebuilds from where you actually are rather than demanding
 * you make up the difference — which is the failure mode of every static plan.
 */

export type Phase = 'BUILD' | 'RECOVERY' | 'TAPER' | 'EVENT';

export interface DayPeriodization {
  phase: Phase;
  /** 1-based week of the plan, counted from the target's startedOn. */
  phaseWeek: number;
  /** Scales that weekday's standing hours from TrainingPlanConfig. */
  loadMultiplier: number;
  daysToEvent: number;
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

export interface PeriodizationContext {
  target: TrainingTarget;
  /** The athlete's real CTL right now, from lib/fitness.ts. */
  currentCtl: number;
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

/** Build weeks between two week indices, i.e. excluding the recovery weeks. */
function buildWeeksBetween(fromWeek: number, toWeek: number, recoveryEveryNWeeks: number): number {
  if (toWeek <= fromWeek) return 0;
  let count = 0;
  for (let w = fromWeek + 1; w <= toWeek; w++) {
    if (recoveryEveryNWeeks > 0 && w % recoveryEveryNWeeks === 0) continue;
    count++;
  }
  return count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The un-tapered, un-recovery-adjusted multiplier for a given week: how much
 * bigger (or smaller) that week needs to be than the standing weekly hours for
 * CTL to be on its ramp by then.
 */
function rampMultiplier(ctx: PeriodizationContext, buildWeeksAhead: number): number {
  const { target, currentCtl, tssPerHour, weeklyHours } = ctx;

  const baselineDailyTss = (weeklyHours * tssPerHour) / 7;
  if (baselineDailyTss <= 0) return 1;

  // CTL settles at whatever the average daily load is, so the athlete's own
  // weekly hours already say what fitness they can hold.
  const ceiling = target.peakCtl ?? baselineDailyTss * SUSTAINABLE_STRETCH;
  const desiredCtl = Math.min(ceiling, currentCtl + target.rampPerWeek * buildWeeksAhead);

  // Once the ceiling is reached the job is to hold it, which needs daily load
  // equal to CTL rather than above it.
  const atPeak = desiredCtl >= ceiling;
  const requiredDailyTss = desiredCtl + (atPeak ? 0 : target.rampPerWeek * DAILY_TSS_PER_CTL_POINT);

  return requiredDailyTss / baselineDailyTss;
}

/**
 * Where a given date sits in the plan, and what that does to its hours.
 * Returns null once the event is in the past — the target stops influencing
 * anything rather than silently going on forever.
 */
export function periodizeDay(date: Date, today: Date, ctx: PeriodizationContext): DayPeriodization | null {
  const { target } = ctx;
  const eventDay = utcMidnight(target.date);
  const day = utcMidnight(date);
  const daysToEvent = daysBetween(day, eventDay);
  if (daysToEvent < 0) return null;

  const weekOf = (d: Date) => Math.floor(daysBetween(utcMidnight(target.startedOn), d) / 7) + 1;
  const phaseWeek = Math.max(1, weekOf(day));
  const todayWeek = Math.max(1, weekOf(today));
  const buildWeeksAhead = buildWeeksBetween(todayWeek, phaseWeek, target.recoveryEveryNWeeks);

  if (daysToEvent === 0) {
    return { phase: 'EVENT', phaseWeek, loadMultiplier: 0, daysToEvent };
  }

  const base = rampMultiplier(ctx, buildWeeksAhead);

  if (daysToEvent <= target.taperDays) {
    // Ease down from wherever the build had got to, capped at a normal week —
    // a taper from a modest block and one from a big block shouldn't land on
    // the same number, but neither should start above the athlete's usual load.
    const atTaperStart = clamp(base, MIN_MULTIPLIER, TAPER_CEILING);
    const progress = daysToEvent / target.taperDays; // 1 at the start, ~0 at the event
    const multiplier = target.taperFloor + (atTaperStart - target.taperFloor) * progress;
    return { phase: 'TAPER', phaseWeek, loadMultiplier: clamp(multiplier, target.taperFloor, MAX_MULTIPLIER), daysToEvent };
  }

  const isRecoveryWeek = target.recoveryEveryNWeeks > 0 && phaseWeek % target.recoveryEveryNWeeks === 0;
  const multiplier = clamp(base, MIN_MULTIPLIER, MAX_MULTIPLIER) * (isRecoveryWeek ? target.recoveryMultiplier : 1);

  return {
    phase: isRecoveryWeek ? 'RECOVERY' : 'BUILD',
    phaseWeek,
    loadMultiplier: clamp(multiplier, MIN_MULTIPLIER, MAX_MULTIPLIER),
    daysToEvent,
  };
}

export function describePhase(p: DayPeriodization, targetName: string): string {
  switch (p.phase) {
    case 'EVENT':
      return targetName;
    case 'TAPER':
      return `Taper — ${p.daysToEvent} day${p.daysToEvent === 1 ? '' : 's'} to ${targetName}`;
    case 'RECOVERY':
      return `Recovery week — week ${p.phaseWeek}`;
    case 'BUILD':
      return `Build week ${p.phaseWeek}`;
  }
}
