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

// Pace (min/km) for Run/Walk, from an aggregate duration + distance.
export function formatPace(durationMin: number, distanceKm: number): string | null {
  if (!distanceKm) return null;
  const secPerKm = (durationMin * 60) / distanceKm;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

// Average speed (km/h) for Ride, from an aggregate duration + distance.
export function formatSpeed(durationMin: number, distanceKm: number): string | null {
  if (!distanceKm) return null;
  const kmh = distanceKm / (durationMin / 60);
  return `${kmh.toFixed(1)} km/h`;
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

// "Today" / "Yesterday" / weekday name / short date, in UTC calendar days —
// same UTC-anchoring reasoning as formatDateUTC above.
export function formatRelativeDay(date: string | Date): string {
  const target = dateOnlyUTC(new Date(date));
  const today = dateOnlyUTC(new Date());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return formatDateUTC(date, { weekday: 'short' });
  return formatDateUTC(date);
}

function dateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function formatTimeUTC(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false },
): string {
  return new Date(date).toLocaleTimeString(undefined, { ...options, timeZone: 'UTC' });
}

// A wall-clock time for a real instant — bedtime, wake time. Read in local
// time on purpose, unlike formatTimeUTC above: those are stored as the moment
// they happened rather than as a position within a calendar day, and a night
// that began at 23:00 has to read as 23:00 and not as the UTC 21:00 behind it.
export function formatClockTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Relative wording for an instant (not a calendar day) — sync timestamps are
// real moments in time, so unlike formatDateUTC these are read in local time.
export function formatTimeAgo(date: string | Date): string {
  const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return `on ${new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
