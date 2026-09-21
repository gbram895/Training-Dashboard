import type { TrainingPlanConfig } from '../api/types';

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const CONFIG_HOUR_KEYS = [
  'sundayHours',
  'mondayHours',
  'tuesdayHours',
  'wednesdayHours',
  'thursdayHours',
  'fridayHours',
  'saturdayHours',
] as const;

/** The recurring weekly target for a given date's weekday, from the plan config. */
export function configHoursForDate(config: TrainingPlanConfig | null | undefined, dateStr: string): number {
  if (!config) return 0;
  const day = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return config[CONFIG_HOUR_KEYS[day.getUTCDay()]];
}

export function weekdayLabel(dateStr: string): { name: string; date: string; isToday: boolean } {
  // The API sends a full ISO timestamp (Prisma's DateTime serialized as JSON),
  // not a bare YYYY-MM-DD — normalize before using it as a calendar day.
  const dayKey = dateStr.slice(0, 10);
  const d = new Date(`${dayKey}T00:00:00Z`);
  return {
    name: d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }),
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    isToday: dayKey === todayKey(),
  };
}
