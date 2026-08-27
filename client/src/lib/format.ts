export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatDistance(km: number): string {
  return `${km.toFixed(2)} km`;
}

// Our dates represent "this calendar day" in the data's origin timezone, stored
// as UTC-midnight (or a UTC timestamp derived from it). Formatting with the
// viewer's local timezone can shift the displayed day by one — force UTC so
// every viewer sees the same calendar day regardless of where they are.
export function formatDateUTC(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  return new Date(date).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
}

export function formatTimeUTC(date: string | Date, options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }): string {
  return new Date(date).toLocaleTimeString(undefined, { ...options, timeZone: 'UTC' });
}
