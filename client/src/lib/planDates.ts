export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
