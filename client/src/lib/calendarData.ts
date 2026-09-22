import type { CalendarDay, WorkoutType } from '../api/types';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Monday-first, matching how the rest of the app buckets a week. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Each discipline keeps the colour it already has on the dashboard charts, so
// a blue dot means the same thing on the calendar as it does there.
export const TYPE_COLOR: Record<WorkoutType, string> = {
  RIDE: 'var(--chart-ride)',
  RUN: 'var(--chart-run)',
  SWIM: 'var(--chart-swim)',
  BADMINTON: 'var(--chart-badminton)',
  STRENGTH: 'var(--chart-z4)',
  WALK: 'var(--chart-z3)',
  OTHER: 'var(--text-faint)',
};

export function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDayKey(key: string): Date {
  return new Date(`${key.slice(0, 10)}T00:00:00Z`);
}

export function todayKeyUTC(): string {
  return dayKeyOf(new Date());
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/**
 * The calendar grid for a month: whole weeks, Monday-first, with the days that
 * spill in from the neighbouring months included so every row is seven wide.
 */
export function monthGrid(year: number, month: number): { key: string; date: Date; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month, 1));
  // getUTCDay() is Sunday-first; shift so Monday starts the row.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  const weeks: { key: string; date: Date; inMonth: boolean }[][] = [];
  const cursor = new Date(start);
  // Six rows covers every month layout; trailing all-outside rows are dropped.
  for (let w = 0; w < 6; w++) {
    const week: { key: string; date: Date; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(cursor);
      week.push({ key: dayKeyOf(date), date, inMonth: date.getUTCMonth() === month });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (w >= 4 && week.every((c) => !c.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

export function indexDays(days: CalendarDay[]): Map<string, CalendarDay> {
  const map = new Map<string, CalendarDay>();
  for (const day of days) map.set(day.date.slice(0, 10), day);
  return map;
}

export function doneMinutes(day: CalendarDay | undefined): number {
  return (day?.done ?? []).reduce((sum, w) => sum + w.durationMin, 0);
}

export function doneTss(day: CalendarDay | undefined): number {
  return (day?.done ?? []).reduce((sum, w) => sum + (w.tss ?? 0), 0);
}

/**
 * What a single day amounts to, which is the whole point of putting the plan
 * and the workouts on one grid:
 *
 * - `done`     something was planned and something was trained
 * - `extra`    trained on a day the plan didn't ask for (or had down as rest)
 * - `missed`   the plan asked for a session, the day has passed, nothing came in
 * - `planned`  still ahead, a session is picked for it
 * - `rest`     a deliberate rest day
 * - `expected` beyond the generated plan window, the standing rhythm says train
 * - `empty`    nothing either way
 */
export type DayStatus = 'done' | 'extra' | 'missed' | 'planned' | 'rest' | 'expected' | 'empty';

export function dayStatus(
  key: string,
  day: CalendarDay | undefined,
  todayKey: string,
  planHorizon: string,
  weeklyHours: number[] | null,
): DayStatus {
  const trained = (day?.done?.length ?? 0) > 0;
  const planned = day?.planned;
  const isPast = key < todayKey;

  if (trained) {
    if (planned && !planned.isRestDay) return 'done';
    return 'extra';
  }
  if (planned?.isRestDay) return 'rest';
  if (planned) return isPast ? 'missed' : 'planned';
  if (!isPast && key > planHorizon && weeklyHours) {
    const weekday = parseDayKey(key).getUTCDay();
    return weeklyHours[weekday] > 0 ? 'expected' : 'rest';
  }
  return 'empty';
}

export interface RangeTotals {
  sessions: number;
  minutes: number;
  distanceKm: number;
  tss: number;
  plannedSessions: number;
  missed: number;
}

/** Totals over a set of days — the summary line above a month or a year. */
export function totalsFor(
  keys: string[],
  byDay: Map<string, CalendarDay>,
  todayKey: string,
  planHorizon: string,
  weeklyHours: number[] | null,
): RangeTotals {
  const totals: RangeTotals = { sessions: 0, minutes: 0, distanceKm: 0, tss: 0, plannedSessions: 0, missed: 0 };
  for (const key of keys) {
    const day = byDay.get(key);
    for (const workout of day?.done ?? []) {
      totals.sessions += 1;
      totals.minutes += workout.durationMin;
      totals.distanceKm += workout.distanceKm ?? 0;
      totals.tss += workout.tss ?? 0;
    }
    if (day?.planned && !day.planned.isRestDay) totals.plannedSessions += 1;
    if (dayStatus(key, day, todayKey, planHorizon, weeklyHours) === 'missed') totals.missed += 1;
  }
  return totals;
}

export function daysOfYear(year: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  while (cursor.getUTCFullYear() === year) {
    keys.push(dayKeyOf(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

const STATUS_WORD: Record<DayStatus, string> = {
  done: 'trained',
  extra: 'trained, unplanned',
  missed: 'planned, missed',
  planned: 'planned',
  rest: 'rest day',
  expected: 'usual training day',
  empty: 'nothing',
};

/** What a screen reader should hear on a day button, e.g. "20 September, trained". */
export function dayLabel(key: string, status: DayStatus): string {
  const date = parseDayKey(key).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${date}, ${STATUS_WORD[status]}`;
}
