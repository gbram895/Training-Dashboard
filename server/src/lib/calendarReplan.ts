import { createHash } from 'node:crypto';
import { prisma } from './prisma.js';
import { localInstant, readCalendar } from './calendarAvailability.js';
import { generatePlanWindow, ROLLING_WINDOW_DAYS } from './trainingPlan.js';
import type { CalendarEvent } from './caldav.js';

// Keeps the plan in step with the phone: a dinner added at lunchtime should
// move tonight's session without anyone pressing anything. Every half hour
// the plan window's busy time is read fresh and digested; the plan is rebuilt
// only when that digest has changed since the last time it was planned
// around, so an unchanged calendar costs one read and no rebuild.

function fingerprint(events: CalendarEvent[]): string {
  const busy = events
    .filter((e) => e.busy && !e.allDay)
    .map((e) => `${e.start}|${e.end}`)
    .sort()
    .join(',');
  return createHash('sha1').update(busy).digest('hex');
}

/** The same range generatePlanWindow reads, so the rebuild that follows reuses this read. */
function planWindowRange(): { from: Date; to: Date } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + ROLLING_WINDOW_DAYS);
  return { from: localInstant(today, '00:00'), to: localInstant(end, '00:00') };
}

/** Rebuilds the plan if the calendar's busy time has changed. Returns whether it did. */
export async function replanIfCalendarChanged(userId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const { from, to } = planWindowRange();
  const read = await readCalendar(userId, from, to, { fresh: true });
  if (!read.connected || read.error) return false;

  const digest = fingerprint(read.events);
  const connection = await prisma.calendarConnection.findUnique({ where: { userId }, select: { planFingerprint: true } });
  if (!opts.force && connection?.planFingerprint === digest) return false;

  await generatePlanWindow(userId);
  await prisma.calendarConnection.update({ where: { userId }, data: { planFingerprint: digest } });
  return true;
}

export async function replanAllForCalendarChanges(): Promise<void> {
  const connections = await prisma.calendarConnection.findMany({
    where: { user: { trainingPlanConfig: { isNot: null } } },
    select: { userId: true },
  });
  for (const { userId } of connections) {
    try {
      if (await replanIfCalendarChanged(userId)) console.log(`[calendar] calendar changed, plan rebuilt for ${userId}`);
    } catch (err) {
      console.error(`[calendar] replan failed for ${userId}:`, err);
    }
  }
}
