import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { asString } from '../lib/params.js';
import {
  CalDavError,
  discoverCalendars,
  feedName,
  fetchFeedText,
  PLAN_FEED_UID_SUFFIX,
  type CalendarEvent,
  type CalendarInfo,
} from '../lib/caldav.js';
import { seal } from '../lib/secretBox.js';
import {
  forgetCachedEvents,
  localDayKey,
  localInstant,
  PLAN_TZ,
  readCalendar,
  storedCalendars,
} from '../lib/calendarAvailability.js';
import { replanIfCalendarChanged } from '../lib/calendarReplan.js';
import { generatePlanWindow, getPlannedWeek } from '../lib/trainingPlan.js';
import { computeFitnessSeries } from '../lib/fitness.js';
import { estimatedTssForBucket } from '../lib/workoutIntensity.js';

const CTL_DECAY = 1 - Math.exp(-1 / 42);
const ATL_DECAY = 1 - Math.exp(-1 / 7);

// The month view on the Plan tab and everything behind connecting it to the
// athlete's own calendar: their iCloud account (and any private .ics link for
// a Google/Outlook calendar), and the feed that puts the planned sessions
// back into the iPhone's Calendar app.

const router = Router();
router.use(requireAuth);

/** A stable id for a calendar that doesn't expose its URL — a pasted link IS its own password. */
function calendarId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

async function ensureConnection(userId: string) {
  return prisma.calendarConnection.upsert({
    where: { userId },
    create: { userId, feedToken: randomBytes(24).toString('base64url') },
    update: {},
  });
}

function feedUrl(req: Request, token: string): string {
  return `${req.protocol}://${req.get('host')}/api/calendar/feed/${token}.ics`;
}

async function status(req: AuthedRequest) {
  const connection = await ensureConnection(req.userId!);
  return {
    appleId: connection.appleId,
    calendars: storedCalendars(connection.calendars).map((c) => ({
      id: calendarId(c.url),
      kind: c.kind,
      name: c.name,
      color: c.color,
      enabled: c.enabled,
    })),
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncError: connection.lastSyncError,
    feedUrl: feedUrl(req, connection.feedToken),
  };
}

async function saveCalendars(userId: string, calendars: CalendarInfo[], extra: Prisma.CalendarConnectionUpdateInput = {}) {
  await prisma.calendarConnection.update({
    where: { userId },
    data: { ...extra, calendars: calendars as unknown as Prisma.InputJsonValue, lastSyncError: null },
  });
  forgetCachedEvents(userId);
  // Whatever just changed changes what the plan has to fit around.
  // (A forced replan only runs while something is connected and readable;
  // after the last calendar goes, or when it can't be read, the plan is
  // rebuilt plainly so it stops fitting around events it can no longer see.)
  try {
    if (!(await replanIfCalendarChanged(userId, { force: true }))) await generatePlanWindow(userId);
  } catch (err) {
    console.error('[calendar] replan after a calendar change failed:', err);
  }
}

// CalDAV refusing the password must not come back as a 401: the client treats
// any 401 as "your session expired" and signs the athlete out.
function calendarError(res: import('express').Response, err: unknown) {
  if (err instanceof CalDavError) return res.status(400).json({ error: err.message });
  throw err;
}

router.get('/connection', async (req: AuthedRequest, res) => {
  res.json(await status(req));
});

const icloudSchema = z.object({
  appleId: z.string().trim().min(3).max(200),
  // Apple shows it as xxxx-xxxx-xxxx-xxxx; people type it back with spaces
  // or no separators at all. Those sixteen letters are put back in Apple's
  // own form, which is the one it is certain to accept.
  appPassword: z
    .string()
    .transform((v) => {
      const letters = v.replace(/[\s-]+/g, '');
      return /^[a-z]{16}$/i.test(letters) ? letters.toLowerCase().match(/.{4}/g)!.join('-') : v.trim();
    })
    .pipe(z.string().min(8).max(64)),
});

router.post('/icloud', async (req: AuthedRequest, res) => {
  const parsed = icloudSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your Apple ID and an app-specific password' });
  const userId = req.userId!;
  const { appleId, appPassword } = parsed.data;

  let found: CalendarInfo[];
  try {
    found = await discoverCalendars(appleId, appPassword);
  } catch (err) {
    return calendarError(res, err);
  }
  if (found.length === 0) return res.status(400).json({ error: 'That iCloud account has no calendars' });

  const connection = await ensureConnection(userId);
  const existing = storedCalendars(connection.calendars);
  // Reconnecting keeps whichever calendars were switched off before.
  const wasOff = new Set(existing.filter((c) => !c.enabled).map((c) => c.url));
  const calendars = [
    ...found.map((c) => ({ ...c, enabled: !wasOff.has(c.url) })),
    ...existing.filter((c) => c.kind === 'ics'),
  ];
  await saveCalendars(userId, calendars, { appleId, appPasswordSealed: seal(appPassword) });
  res.json(await status(req));
});

router.delete('/icloud', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const connection = await ensureConnection(userId);
  const calendars = storedCalendars(connection.calendars).filter((c) => c.kind === 'ics');
  await saveCalendars(userId, calendars, { appleId: null, appPasswordSealed: null });
  res.json(await status(req));
});

const linkSchema = z.object({ url: z.string().trim().regex(/^(https?|webcals?):\/\//i, 'Paste the full link') });

router.post('/links', async (req: AuthedRequest, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Paste the calendar’s full link (starting https:// or webcal://)' });
  const userId = req.userId!;
  const url = parsed.data.url;

  let ics: string;
  try {
    ics = await fetchFeedText(url);
  } catch (err) {
    return calendarError(res, err);
  }

  const connection = await ensureConnection(userId);
  const calendars = storedCalendars(connection.calendars).filter((c) => c.url !== url);
  calendars.push({ kind: 'ics', url, name: feedName(ics) ?? new URL(url.replace(/^webcals?/i, 'https')).hostname, color: null, enabled: true });
  await saveCalendars(userId, calendars);
  res.json(await status(req));
});

router.delete('/calendars/:id', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const id = asString(req.params.id);
  const connection = await ensureConnection(userId);
  const calendars = storedCalendars(connection.calendars);
  const target = calendars.find((c) => calendarId(c.url) === id);
  if (!target) return res.status(404).json({ error: 'No such calendar' });
  if (target.kind !== 'ics') return res.status(400).json({ error: 'Switch an iCloud calendar off instead' });
  await saveCalendars(
    userId,
    calendars.filter((c) => c !== target),
  );
  res.json(await status(req));
});

router.put('/calendars/:id', async (req: AuthedRequest, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  const id = asString(req.params.id);
  const connection = await ensureConnection(userId);
  const calendars = storedCalendars(connection.calendars);
  const target = calendars.find((c) => calendarId(c.url) === id);
  if (!target) return res.status(404).json({ error: 'No such calendar' });
  target.enabled = parsed.data.enabled;
  await saveCalendars(userId, calendars);
  res.json(await status(req));
});

/** An event as the month view needs it: no URLs, nothing it won't show. */
function publicEvent(e: CalendarEvent) {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    busy: e.busy,
    calendar: e.calendar,
    color: e.color,
    location: e.location,
  };
}

/**
 * One month as the calendar shows it: each day's planned session (the plan
 * runs two weeks ahead, so later days have none yet) and the athlete's own
 * events, filed under the local day(s) they fall on. `?fresh=1` skips the
 * few-minute cache, for the refresh button.
 */
router.get('/month', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const monthParam = typeof req.query.month === 'string' ? req.query.month : '';
  const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) - 1 : now.getUTCMonth();
  if (month < 0 || month > 11) return res.status(400).json({ error: 'month must be YYYY-MM' });

  // Whole weeks, Monday first, the way the grid lays the month out — so the
  // days spilling in from either side have their contents too.
  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const gridEnd = new Date(last);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (7 - ((last.getUTCDay() + 6) % 7)));

  // Makes sure the rolling window exists before reading it.
  await getPlannedWeek(userId);

  const [planned, calendar, done, fitness] = await Promise.all([
    prisma.plannedDay.findMany({
      where: { userId, date: { gte: gridStart, lt: gridEnd } },
      orderBy: { date: 'asc' },
    }),
    readCalendar(userId, localInstant(gridStart, '00:00'), localInstant(gridEnd, '00:00'), {
      fresh: req.query.fresh === '1',
    }),
    prisma.workout.findMany({
      where: { userId, date: { gte: gridStart, lt: gridEnd } },
      orderBy: { date: 'asc' },
      select: { id: true, type: true, title: true, date: true, durationMin: true, tss: true },
    }),
    computeFitnessSeries(userId),
  ]);

  const eventsByDay = new Map<string, ReturnType<typeof publicEvent>[]>();
  for (const event of calendar.events) {
    // An all-day event's dates are already day keys; a timed one is filed
    // under every local day it touches, so an overnight trip shows on both.
    let day = event.allDay ? new Date(event.start) : localDayKey(new Date(event.start));
    const endExclusive = event.allDay
      ? new Date(event.end)
      : new Date(localDayKey(new Date(new Date(event.end).getTime() - 1)).getTime() + 86_400_000);
    for (let guard = 0; day < endExclusive && guard < 62; guard++) {
      const key = day.toISOString().slice(0, 10);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key)!.push(publicEvent(event));
      day = new Date(day.getTime() + 86_400_000);
    }
  }

  const plannedByDay = new Map(planned.map((p) => [p.date.toISOString().slice(0, 10), p]));
  // Filed by UTC date, the same way the fitness series and the rest of the
  // app bucket a workout into a day.
  const doneByDay = new Map<string, typeof done>();
  for (const w of done) {
    const key = w.date.toISOString().slice(0, 10);
    if (!doneByDay.has(key)) doneByDay.set(key, []);
    doneByDay.get(key)!.push(w);
  }

  // Fitness, Fatigue and Form per day: the real curve up to today, then
  // carried forward on the plan's own estimated load for as far as the plan
  // goes (the same projection the plan itself is picked against). Past the
  // plan there is nothing to project on, so those days have none.
  const todayKey = new Date().toISOString().slice(0, 10);
  const fitnessByDay = new Map(fitness.map((p) => [p.date, p]));
  const lastReal = fitness.at(-1);
  const lastPlannedKey = planned.at(-1)?.date.toISOString().slice(0, 10) ?? todayKey;
  if (lastReal && lastPlannedKey > todayKey) {
    const futurePlans = await prisma.plannedDay.findMany({
      where: { userId, date: { gt: new Date(`${todayKey}T00:00:00Z`) } },
      orderBy: { date: 'asc' },
      select: { date: true, isRestDay: true, trainingStress: true },
    });
    let ctl = lastReal.ctl;
    let atl = lastReal.atl;
    for (const p of futurePlans) {
      const tsb = ctl - atl;
      const tss = p.isRestDay ? 0 : estimatedTssForBucket(p.trainingStress);
      ctl += (tss - ctl) * CTL_DECAY;
      atl += (tss - atl) * ATL_DECAY;
      const key = p.date.toISOString().slice(0, 10);
      fitnessByDay.set(key, { date: key, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round(tsb * 10) / 10 });
    }
  }

  const days = [];
  for (let d = new Date(gridStart); d < gridEnd; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    const point = fitnessByDay.get(key);
    const plannedDay = plannedByDay.get(key) ?? null;
    days.push({
      date: key,
      planned: plannedDay,
      // A planned session's load as a number on the same scale as a done
      // one, rather than the 1-5 bucket it is stored as.
      plannedLoad: plannedDay && !plannedDay.isRestDay ? estimatedTssForBucket(plannedDay.trainingStress) : null,
      done: (doneByDay.get(key) ?? []).map((w) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        durationMin: w.durationMin,
        load: w.tss != null ? Math.round(w.tss) : null,
      })),
      fitness: point ? { ctl: point.ctl, atl: point.atl, tsb: point.tsb } : null,
      events: eventsByDay.get(key) ?? [],
    });
  }

  res.json({
    month: `${year}-${String(month + 1).padStart(2, '0')}`,
    timezone: PLAN_TZ,
    calendarConnected: calendar.connected,
    calendarError: calendar.error,
    days,
  });
});

export default router;

// --- The plan as an .ics feed -------------------------------------------------

export const calendarFeedRouter = Router();

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** RFC 5545 lines are at most 75 octets; longer ones continue on a line starting with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const len = Buffer.byteLength(char, 'utf8');
    if (size + len > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// Subscribed to from the iPhone (Settings → Calendar → Accounts → Add
// Subscribed Calendar, or just tapping the webcal:// link), which then polls
// it. Sessions with a planned time are timed events; the rest are all-day,
// since "some time Tuesday" is all the plan knows about them. Rest days are
// left out — an empty day says that already.
calendarFeedRouter.get('/:file', async (req, res) => {
  const token = asString(req.params.file).replace(/\.ics$/, '');
  const connection = await prisma.calendarConnection.findUnique({ where: { feedToken: token } });
  if (!connection) return res.status(404).send('Not found');

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 30);
  const days = await prisma.plannedDay.findMany({
    where: { userId: connection.userId, date: { gte: since }, isRestDay: false },
    orderBy: { date: 'asc' },
  });

  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gradient//Training plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Gradient training',
    `X-WR-TIMEZONE:${PLAN_TZ}`,
    // A hint to clients that honour it; iOS uses its own refresh setting.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const day of days) {
    const icon = day.discipline === 'RUN' ? '🏃' : '🚴';
    const minutes = day.durationMin ?? 60;
    const description = [day.focus, day.profile].filter(Boolean).join('\n\n');
    lines.push('BEGIN:VEVENT', `UID:${dateValue(day.date)}${PLAN_FEED_UID_SUFFIX}`, `DTSTAMP:${now}`);
    if (day.plannedStart) {
      lines.push(
        `DTSTART:${stamp(day.plannedStart)}`,
        `DTEND:${stamp(new Date(day.plannedStart.getTime() + minutes * 60_000))}`,
      );
    } else {
      const next = new Date(day.date.getTime() + 86_400_000);
      lines.push(`DTSTART;VALUE=DATE:${dateValue(day.date)}`, `DTEND;VALUE=DATE:${dateValue(next)}`);
    }
    lines.push(
      `SUMMARY:${icsEscape(`${icon} ${day.name ?? 'Training'}`)}`,
      // A planned session shouldn't make the athlete look busy to anyone
      // their calendar is shared with, nor to this app planning around it.
      'TRANSP:TRANSPARENT',
    );
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.map(fold).join('\r\n') + '\r\n');
});
