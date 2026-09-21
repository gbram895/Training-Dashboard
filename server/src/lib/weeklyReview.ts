import { prisma } from './prisma.js';
import { computeFitnessSeries } from './fitness.js';
import { estimatedTssForBucket } from './workoutIntensity.js';

/**
 * What actually happened last week, against what the plan asked for.
 *
 * The app could already tell the athlete what to do today and how fresh they
 * were, but never whether the week added up — whether the sessions happened,
 * where the hours went, and whether fitness is going anywhere. That's the
 * question a training log exists to answer.
 */

export interface ReviewDay {
  date: string; // YYYY-MM-DD
  planned: {
    isRestDay: boolean;
    name: string | null;
    discipline: 'BIKE' | 'RUN' | null;
    durationMin: number | null;
    trainingStress: number | null;
    phase: string | null;
  } | null;
  actual: {
    type: string;
    durationMin: number;
    distanceKm: number | null;
    tss: number | null;
    tssSource: string | null;
    rpe: number | null;
  }[];
  /** Planned a session and something of that discipline was logged. */
  completed: boolean | null;
}

export interface DisciplineTotal {
  type: string;
  sessions: number;
  hours: number;
  tss: number;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  days: ReviewDay[];
  plannedSessions: number;
  completedSessions: number;
  plannedHours: number;
  actualHours: number;
  /** Estimated — planned sessions only carry a 1-5 difficulty bucket. */
  plannedTss: number;
  actualTss: number;
  byDiscipline: DisciplineTotal[];
  fitness: {
    ctlStart: number | null;
    ctlEnd: number | null;
    ctlDelta: number | null;
    ctlDelta4w: number | null;
    ctlDelta12w: number | null;
    tsbEnd: number | null;
  };
  target: {
    name: string;
    date: string;
    daysToEvent: number;
    phase: string | null;
    phaseWeek: number | null;
  } | null;
}

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Monday of the week `weeksAgo` back. 0 is the week in progress, 1 the last
 * completed one — which is what the review defaults to, since a week that
 * hasn't finished can't be judged.
 */
export function weekStartFor(weeksAgo: number, from = new Date()): Date {
  const d = utcMidnight(from);
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayOfWeek - weeksAgo * 7);
  return d;
}

function ctlOn(series: { date: string; ctl: number; tsb: number }[], key: string): number | null {
  // The series has one point per day from the first workout onward, but a date
  // before an athlete's first-ever workout simply isn't in it.
  const exact = series.find((p) => p.date === key);
  if (exact) return exact.ctl;
  const earlier = series.filter((p) => p.date < key);
  return earlier.length ? earlier[earlier.length - 1].ctl : null;
}

export async function buildWeeklyReview(userId: string, weeksAgo = 1): Promise<WeeklyReview> {
  const weekStart = weekStartFor(weeksAgo);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const exclusiveEnd = new Date(weekEnd);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

  const [plannedDays, workouts, series, target] = await Promise.all([
    prisma.plannedDay.findMany({
      where: { userId, date: { gte: weekStart, lte: weekEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.workout.findMany({
      where: { userId, date: { gte: weekStart, lt: exclusiveEnd } },
      orderBy: { date: 'asc' },
    }),
    computeFitnessSeries(userId),
    prisma.trainingTarget.findUnique({ where: { userId } }),
  ]);

  const plannedByDate = new Map(plannedDays.map((p) => [dateKey(p.date), p]));
  const workoutsByDate = new Map<string, typeof workouts>();
  for (const w of workouts) {
    const key = dateKey(w.date);
    const list = workoutsByDate.get(key) ?? [];
    list.push(w);
    workoutsByDate.set(key, list);
  }

  const days: ReviewDay[] = [];
  let plannedSessions = 0;
  let completedSessions = 0;
  let plannedHours = 0;
  let plannedTss = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setUTCDate(date.getUTCDate() + i);
    const key = dateKey(date);
    const planned = plannedByDate.get(key) ?? null;
    const actual = workoutsByDate.get(key) ?? [];

    let completed: boolean | null = null;
    if (planned && !planned.isRestDay) {
      plannedSessions++;
      plannedHours += (planned.durationMin ?? 0) / 60;
      // PlannedDay.trainingStress is a 1-5 difficulty bucket, not a training
      // stress score — it has to be converted before it can be compared with
      // the real TSS of what was actually logged.
      plannedTss += estimatedTssForBucket(planned.trainingStress);
      // Same rule the plan's own readiness check uses: the day counts if
      // something of the planned discipline was logged.
      const wanted = planned.discipline === 'RUN' ? 'RUN' : 'RIDE';
      completed = actual.some((w) => w.type === wanted);
      if (completed) completedSessions++;
    }

    days.push({
      date: key,
      planned: planned
        ? {
            isRestDay: planned.isRestDay,
            name: planned.name,
            discipline: planned.discipline,
            durationMin: planned.durationMin,
            trainingStress: planned.trainingStress,
            phase: planned.phase,
          }
        : null,
      actual: actual.map((w) => ({
        type: w.type,
        durationMin: w.durationMin,
        distanceKm: w.distanceKm,
        tss: w.tss,
        tssSource: w.tssSource,
        rpe: w.rpe,
      })),
      completed,
    });
  }

  const byDisciplineMap = new Map<string, DisciplineTotal>();
  for (const w of workouts) {
    const row = byDisciplineMap.get(w.type) ?? { type: w.type, sessions: 0, hours: 0, tss: 0 };
    row.sessions++;
    row.hours += w.durationMin / 60;
    row.tss += w.tss ?? 0;
    byDisciplineMap.set(w.type, row);
  }
  const byDiscipline = [...byDisciplineMap.values()]
    .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10, tss: Math.round(r.tss) }))
    .sort((a, b) => b.tss - a.tss || b.hours - a.hours);

  const dayBefore = new Date(weekStart);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const fourWeeksBefore = new Date(weekEnd);
  fourWeeksBefore.setUTCDate(fourWeeksBefore.getUTCDate() - 28);
  const twelveWeeksBefore = new Date(weekEnd);
  twelveWeeksBefore.setUTCDate(twelveWeeksBefore.getUTCDate() - 84);

  const ctlStart = ctlOn(series, dateKey(dayBefore));
  const ctlEnd = ctlOn(series, dateKey(weekEnd));
  const ctl4w = ctlOn(series, dateKey(fourWeeksBefore));
  const ctl12w = ctlOn(series, dateKey(twelveWeeksBefore));
  const tsbEnd = series.find((p) => p.date === dateKey(weekEnd))?.tsb ?? null;

  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

  const eventDay = target ? utcMidnight(target.date) : null;
  const todayKey = utcMidnight(new Date());

  return {
    weekStart: dateKey(weekStart),
    weekEnd: dateKey(weekEnd),
    isCurrentWeek: weeksAgo === 0,
    days,
    plannedSessions,
    completedSessions,
    plannedHours: Math.round(plannedHours * 10) / 10,
    actualHours: Math.round((workouts.reduce((s, w) => s + w.durationMin, 0) / 60) * 10) / 10,
    plannedTss: Math.round(plannedTss),
    actualTss: Math.round(workouts.reduce((s, w) => s + (w.tss ?? 0), 0)),
    byDiscipline,
    fitness: {
      ctlStart: round1(ctlStart),
      ctlEnd: round1(ctlEnd),
      ctlDelta: ctlStart != null && ctlEnd != null ? round1(ctlEnd - ctlStart) : null,
      ctlDelta4w: ctl4w != null && ctlEnd != null ? round1(ctlEnd - ctl4w) : null,
      ctlDelta12w: ctl12w != null && ctlEnd != null ? round1(ctlEnd - ctl12w) : null,
      tsbEnd: round1(tsbEnd),
    },
    target:
      target && eventDay
        ? {
            name: target.name,
            date: dateKey(eventDay),
            daysToEvent: Math.round((eventDay.getTime() - todayKey.getTime()) / 86_400_000),
            phase: plannedByDate.get(dateKey(weekEnd))?.phase ?? null,
            phaseWeek: plannedByDate.get(dateKey(weekEnd))?.phaseWeek ?? null,
          }
        : null,
  };
}
