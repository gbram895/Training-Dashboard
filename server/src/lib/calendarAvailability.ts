import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { CalDavError, fetchEvents, type CalendarEvent, type CalendarInfo } from './caldav.js';
import { unseal } from './secretBox.js';

// When in the day the athlete can train, and what in their own calendar is
// already in the way. The plan used to know only "1.5 hours on Tuesday"; this
// turns that into "Tuesday between 18:00 and 21:00, minus the dentist at
// 18:30", which both caps how long the session can be and says when it goes.
//
// Everything here is local wall-clock time in PLAN_TZ, the same zone the sync
// crons run in, since "18:00" means 18:00 on the athlete's watch across the
// CET/CEST switch. Plan dates themselves stay UTC-midnight keys of the local
// day, as everywhere else in the plan.

export const PLAN_TZ = process.env.SYNC_TZ ?? 'Europe/Brussels';

export interface TimeWindow {
  /** "HH:MM", local. */
  start: string;
  /** "HH:MM", local; after start. */
  end: string;
}

/** Keyed by JS getDay() as a string, "0" = Sunday. A missing weekday means "any time". */
export type TrainingWindows = Partial<Record<string, TimeWindow[]>>;

/** Used for a weekday with no windows of its own once a calendar is connected. */
const DEFAULT_DAY: TimeWindow = { start: '06:00', end: '22:00' };

// A gap shorter than this is not somewhere a session goes, however the hours
// add up — changing, warming up and showering alone take most of it.
export const MIN_SESSION_MIN = 30;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseTrainingWindows(value: unknown): TrainingWindows | null {
  if (!value || typeof value !== 'object') return null;
  const out: TrainingWindows = {};
  for (const [day, list] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(list)) continue;
    const windows = list.filter(
      (w): w is TimeWindow =>
        !!w && HHMM.test((w as TimeWindow).start) && HHMM.test((w as TimeWindow).end) && (w as TimeWindow).start < (w as TimeWindow).end,
    );
    if (windows.length) out[day] = windows.map(({ start, end }) => ({ start, end }));
  }
  return out;
}

/** Minutes east of UTC that `tz` is at `instant`. */
function offsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant that is `hhmm` local time on the local day `dayKey` (a UTC-midnight date). */
export function localInstant(dayKey: Date, hhmm: string, tz = PLAN_TZ): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const naive = Date.UTC(dayKey.getUTCFullYear(), dayKey.getUTCMonth(), dayKey.getUTCDate(), h, m);
  // Correct by the offset at the guess, then once more in case the guess sat
  // across a DST change from the answer.
  let instant = naive - offsetMinutes(new Date(naive), tz) * 60_000;
  instant = naive - offsetMinutes(new Date(instant), tz) * 60_000;
  return new Date(instant);
}

/** "18:30", local. */
export function localClock(instant: Date, tz = PLAN_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    instant,
  );
}

/** The local day an instant falls on, as a UTC-midnight key. */
export function localDayKey(instant: Date, tz = PLAN_TZ): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
  return new Date(`${parts}T00:00:00Z`);
}

interface Span {
  start: Date;
  end: Date;
}

export interface DaySlot {
  /** The free stretches inside the day's training windows, in order. */
  free: Span[];
  longestFreeMin: number;
  /** The athlete's own events that took time out of the windows. */
  conflicts: CalendarEvent[];
  /** Whether the windows came from the athlete rather than the any-time default. */
  hasOwnWindows: boolean;
}

/**
 * What of one day is free to train in: its windows minus every busy, timed
 * event that overlaps them. An all-day event ("Holiday", a birthday) never
 * blocks — most of them are reminders rather than time taken — and an event
 * marked "Show as: Free" doesn't either.
 */
export function slotForDay(dayKey: Date, windows: TrainingWindows | null, events: CalendarEvent[], tz = PLAN_TZ): DaySlot {
  const own = windows?.[String(dayKey.getUTCDay())];
  const dayWindows = own?.length ? own : [DEFAULT_DAY];

  const busy = events
    .filter((e) => e.busy && !e.allDay)
    .map((e) => ({ event: e, start: new Date(e.start), end: new Date(e.end) }));

  const free: Span[] = [];
  const conflicts = new Set<CalendarEvent>();
  for (const w of dayWindows) {
    let pieces: Span[] = [{ start: localInstant(dayKey, w.start, tz), end: localInstant(dayKey, w.end, tz) }];
    for (const b of busy) {
      const next: Span[] = [];
      for (const p of pieces) {
        if (b.end <= p.start || b.start >= p.end) {
          next.push(p);
          continue;
        }
        conflicts.add(b.event);
        if (b.start > p.start) next.push({ start: p.start, end: b.start });
        if (b.end < p.end) next.push({ start: b.end, end: p.end });
      }
      pieces = next;
    }
    free.push(...pieces);
  }
  free.sort((a, b) => a.start.getTime() - b.start.getTime());

  const longestFreeMin = free.reduce((max, s) => Math.max(max, (s.end.getTime() - s.start.getTime()) / 60_000), 0);
  return { free, longestFreeMin: Math.floor(longestFreeMin), conflicts: [...conflicts], hasOwnWindows: !!own?.length };
}

/** When a session of `minutes` goes: the earliest gap it fits in, else the start of the longest one. */
export function placeSession(slot: DaySlot, minutes: number): Date | null {
  if (!slot.free.length) return null;
  const fits = slot.free.find((s) => s.end.getTime() - s.start.getTime() >= minutes * 60_000);
  if (fits) return fits.start;
  return slot.free.reduce((a, b) => (b.end.getTime() - b.start.getTime() > a.end.getTime() - a.start.getTime() ? b : a))
    .start;
}

/** "18:30–19:45 and 20:30–21:00" — the free gaps, for a line of explanation. */
export function describeFree(slot: DaySlot, tz = PLAN_TZ): string {
  const spans = slot.free
    .filter((s) => s.end.getTime() - s.start.getTime() >= 15 * 60_000)
    .map((s) => `${localClock(s.start, tz)}–${localClock(s.end, tz)}`);
  if (spans.length <= 1) return spans[0] ?? 'nothing';
  return `${spans.slice(0, -1).join(', ')} and ${spans[spans.length - 1]}`;
}

// --- Reading the calendar ----------------------------------------------------

export function storedCalendars(value: Prisma.JsonValue | null | undefined): CalendarInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c: any) =>
    c && typeof c.url === 'string'
      ? [
          {
            kind: c.kind === 'ics' ? 'ics' : 'caldav',
            url: c.url,
            name: typeof c.name === 'string' ? c.name : 'Calendar',
            color: typeof c.color === 'string' ? c.color : null,
            enabled: c.enabled !== false,
          } as CalendarInfo,
        ]
      : [],
  );
}

// The plan regenerates several times on one tap (an availability change
// re-runs the whole window), and the month view is opened and re-opened: a few
// minutes of reuse keeps that from being a round of iCloud requests each time,
// while still being "live" on the scale anyone moves a meeting at.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; events: CalendarEvent[] }>();

export function forgetCachedEvents(userId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${userId}|`)) cache.delete(key);
}

export interface CalendarRead {
  /** False when nothing is connected; the plan then ignores the calendar entirely. */
  connected: boolean;
  events: CalendarEvent[];
  /** Set when a connection exists but could not be read this time. */
  error: string | null;
}

/** The athlete's events in [from, to), from every enabled calendar. Never throws. */
export async function readCalendar(userId: string, from: Date, to: Date, opts: { fresh?: boolean } = {}): Promise<CalendarRead> {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId } });
  const calendars = storedCalendars(connection?.calendars).filter((c) => c.enabled);
  if (!connection || calendars.length === 0) return { connected: false, events: [], error: null };

  const key = `${userId}|${from.toISOString()}|${to.toISOString()}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return { connected: true, events: hit.events, error: null };

  const password = connection.appPasswordSealed ? unseal(connection.appPasswordSealed) : null;
  const account = connection.appleId && password ? { appleId: connection.appleId, password } : null;
  const now = new Date();
  try {
    if (!account && calendars.some((c) => c.kind === 'caldav')) {
      throw new CalDavError('The saved iCloud password can no longer be read. Connect the calendar again.');
    }
    const events = await fetchEvents(account, calendars, from, to);
    cache.set(key, { at: Date.now(), events });
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    await prisma.calendarConnection.update({
      where: { userId },
      data: { lastAttemptedAt: now, lastSyncedAt: now, lastSyncError: null },
    });
    return { connected: true, events, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read the calendar';
    await prisma.calendarConnection.update({
      where: { userId },
      data: { lastAttemptedAt: now, lastSyncError: message },
    });
    // A stale read beats planning as if the calendar were empty.
    if (hit) return { connected: true, events: hit.events, error: message };
    return { connected: true, events: [], error: message };
  }
}
