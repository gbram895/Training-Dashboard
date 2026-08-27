// Dates from the API are UTC-midnight-normalized calendar days. All week-boundary
// math here uses UTC methods so it lines up with the server's grouping and doesn't
// drift based on the viewer's own timezone offset.

export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function weekKey(date: Date): string {
  return mondayOf(date).toISOString().slice(0, 10);
}

export function dateKey(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}
