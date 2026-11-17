import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { unseal } from './secretBox.js';
import { localInstant } from './calendarAvailability.js';
import { fetchPlannedWorkouts, IntervalsError, toImportedWorkout, type ImportedWorkout } from './intervals.js';
import { readinessWarningFor, ROLLING_WINDOW_DAYS } from './trainingPlan.js';
import type { AthleteThresholds } from './workoutFormats.js';

// Rest or Train builds the plan; Gradient follows it. Each day of the rolling
// window is written as Intervals.icu has it planned, and nothing here picks,
// moves or downgrades a session. The one thing Gradient adds is a warning on
// today when readiness says the session is too hard (Bram, 2026-11-17:
// "follow it, flag low readiness").

const SOURCE_LABEL = 'Rest or Train';

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function loadThresholds(userId: string): Promise<AthleteThresholds> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true, hrZone4Max: true },
  });
  return {
    ftpWatts: user.ftpWatts,
    thresholdSpeedMps: user.thresholdPaceSecPerKm > 0 ? 1000 / user.thresholdPaceSecPerKm : 0,
    thresholdHrBpm: user.hrZone4Max,
  };
}

function dayKeyOf(startDateLocal: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDateLocal ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * Reads the plan window from Intervals.icu and writes it as the plan. Returns
 * false when the athlete has no Intervals.icu connection, so the caller can
 * plan the usual way instead. A failed read leaves the days already imported
 * as they are (and records why) rather than replacing Rest or Train's plan
 * with Gradient's own picks.
 */
export async function importIntervalsPlan(userId: string): Promise<boolean> {
  const connection = await prisma.intervalsConnection.findUnique({ where: { userId } });
  if (!connection) return false;

  const today = utcMidnight(new Date());
  const dates: Date[] = [];
  for (let i = 0; i < ROLLING_WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d);
  }

  await prisma.intervalsConnection.update({ where: { userId }, data: { lastAttemptedAt: new Date() } });

  const apiKey = unseal(connection.apiKeySealed);
  if (!apiKey) {
    await prisma.intervalsConnection.update({
      where: { userId },
      data: { lastSyncError: 'The saved API key can no longer be read. Enter it again in Settings.' },
    });
    return true;
  }

  let events;
  try {
    events = await fetchPlannedWorkouts(apiKey, connection.athleteId, dates[0], dates[dates.length - 1]);
  } catch (err) {
    const message = err instanceof IntervalsError ? err.message : `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[intervals] plan import failed for ${userId}:`, err);
    await prisma.intervalsConnection.update({ where: { userId }, data: { lastSyncError: message.slice(0, 500) } });
    return true;
  }

  const thresholds = await loadThresholds(userId);
  const byDay = new Map<number, { workouts: ImportedWorkout[]; other: string[] }>();
  for (const event of events) {
    const key = dayKeyOf(event.start_date_local);
    if (key == null) continue;
    const entry = byDay.get(key) ?? { workouts: [], other: [] };
    const workout = toImportedWorkout(event, thresholds);
    if (workout) entry.workouts.push(workout);
    else entry.other.push(`${event.type ?? 'Other'}${event.name && event.name !== event.type ? ` (${event.name})` : ''}`);
    byDay.set(key, entry);
  }

  let imported = 0;
  await Promise.all(
    dates.map(async (date) => {
      const entry = byDay.get(date.getTime());
      // Gradient keeps one session a day. On a day with two (a ride and a
      // run), the longer one is the day's session and the other is named.
      const sorted = [...(entry?.workouts ?? [])].sort((a, b) => (b.durationMin ?? 0) - (a.durationMin ?? 0));
      const main = sorted[0];
      const alsoPlanned = [...sorted.slice(1).map((w) => w.name), ...(entry?.other ?? [])];
      const isToday = date.getTime() === today.getTime();

      const content = main
        ? {
            isRestDay: false,
            restReason: null,
            sourcePath: `intervals:${main.externalId}`,
            externalId: main.externalId,
            name: main.name,
            discipline: main.discipline,
            durationMin: main.durationMin ?? null,
            intensity: main.intensity ?? null,
            trainingStress: main.trainingStress ?? null,
            profile: main.profile ?? null,
            segments: main.segments.length ? (main.segments as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            category: main.category ?? null,
            focus:
              `Planned by ${SOURCE_LABEL}.` + (alsoPlanned.length ? ` Also planned that day: ${alsoPlanned.join(', ')}.` : ''),
            plannedStart: main.startTime ? localInstant(date, main.startTime) : null,
            readinessWarning: isToday ? await readinessWarningFor(userId, main.category).catch(() => null) : null,
          }
        : {
            isRestDay: true,
            restReason: alsoPlanned.length
              ? `${SOURCE_LABEL} planned ${alsoPlanned.join(', ')}. Gradient only shows rides and runs.`
              : `Nothing planned in ${SOURCE_LABEL} for this day.`,
            sourcePath: null,
            externalId: null,
            name: null,
            discipline: null,
            durationMin: null,
            intensity: null,
            trainingStress: null,
            profile: null,
            segments: Prisma.DbNull,
            category: null,
            focus: null,
            plannedStart: null,
            readinessWarning: null,
          };
      if (main) imported++;

      const data = {
        ...content,
        // Nothing Gradient decides applies to someone else's plan.
        templateId: null,
        confidence: null,
        confidenceNote: null,
        phase: null,
        phaseWeek: null,
        loadMultiplier: null,
        manualOverride: false,
        generatedAt: new Date(),
      };
      await prisma.plannedDay.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...data },
        update: data,
      });
    }),
  );

  await prisma.intervalsConnection.update({
    where: { userId },
    data: { lastSyncedAt: new Date(), lastSyncError: null, lastEventCount: imported },
  });
  return true;
}

/** The scheduled half-hourly import, for every athlete following an Intervals.icu plan. */
export async function importAllIntervalsPlans(): Promise<void> {
  const connections = await prisma.intervalsConnection.findMany({
    where: { user: { trainingPlanConfig: { planSource: 'INTERVALS' } } },
    select: { userId: true },
  });
  for (const { userId } of connections) {
    try {
      await importIntervalsPlan(userId);
    } catch (err) {
      console.error(`[intervals] import failed for ${userId}:`, err);
    }
  }
}
