import { CronExpressionParser } from 'cron-parser';
import { prisma } from './prisma.js';

/**
 * Background schedules that survive the process.
 *
 * These jobs used to be `node-cron` timers registered inside the Express
 * process. A timer only fires while the process is alive, and this app runs on
 * a free instance that sleeps after fifteen idle minutes and restarts on every
 * deploy — so a slot that came due while the service was down was simply never
 * run, and nobody was any the wiser until the dashboard showed data from
 * yesterday.
 *
 * Here a job's due date lives in Postgres instead. A tick asks what is due,
 * claims it, runs it, and writes down when it is next due. That makes two
 * things true that were not before: the schedule cannot be lost by a restart,
 * and a run missed during an outage is still owed afterwards, so it happens as
 * soon as anything ticks again. Ticks come from a timer while the service is
 * up (see index.ts) and from POST /api/cron/tick, which an external heartbeat
 * calls so the service gets woken and caught up even when it has been asleep.
 */

/** A missed run of this job is worth making up however late it is. */
export const ALWAYS_CATCH_UP = Number.POSITIVE_INFINITY;

export type JobDefinition = {
  /** Stable key; also the ScheduledJob primary key, so don't rename casually. */
  name: string;
  /** Standard five-field cron expression. */
  schedule: string;
  /** IANA zone the expression is read in, so hour-of-day survives CET/CEST. */
  timezone: string;
  run: () => Promise<unknown>;
  /**
   * How late a missed run may be and still be worth doing. Catching up a sync
   * is always welcome — the data is just as true an hour late. Catching up a
   * notification is not: an 8am "today's session is ready" push delivered at
   * 2pm is noise, so those jobs give up and wait for tomorrow instead.
   */
  catchUpWindowMinutes: number;
  /**
   * What a job that has never run before is owed. 'now' runs it shortly after
   * it is first registered; 'next' waits for its first real slot, which is
   * what anything that notifies the user wants — a deploy should not fire a
   * push.
   */
  firstRun: 'now' | 'next';
};

export type JobOutcome = {
  name: string;
  /** When the run was owed, which may be well before it actually started. */
  dueAt: Date;
  minutesLate: number;
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
};

/**
 * A run that has not written back for this long is assumed dead — the process
 * it was running in was killed or redeployed mid-job — and its lock is taken
 * over rather than wedging the job forever.
 */
const LOCK_TIMEOUT_MS = 30 * 60_000;

/** Postgres will take a longer string, but nothing reads more than this. */
const MAX_ERROR_CHARS = 500;

const jobs = new Map<string, JobDefinition>();

function nextOccurrence(schedule: string, timezone: string, from: Date): Date {
  return CronExpressionParser.parse(schedule, { currentDate: from, tz: timezone }).next().toDate();
}

/**
 * Records a job to be run on its schedule. Call this for every job before
 * {@link primeJobs}; registering is cheap and touches no database.
 */
export function registerJob(job: JobDefinition): void {
  // Parse now rather than at the first tick: a typo in SYNC_CRON should fail
  // the deploy loudly, not quietly stop a sync from ever being scheduled.
  nextOccurrence(job.schedule, job.timezone, new Date());
  jobs.set(job.name, job);
  console.log(`[scheduler] ${job.name}: "${job.schedule}" (${job.timezone})`);
}

/**
 * Gives every registered job a row and a due date. Existing rows keep the due
 * date they already had — that is the whole point, an overdue job stays
 * overdue across a restart — except when the expression itself has changed,
 * where the old due date was derived from a schedule that no longer applies.
 */
export async function primeJobs(): Promise<void> {
  const now = new Date();

  for (const job of jobs.values()) {
    const existing = await prisma.scheduledJob.findUnique({ where: { name: job.name } });

    if (!existing) {
      const nextRunAt = job.firstRun === 'now' ? now : nextOccurrence(job.schedule, job.timezone, now);
      await prisma.scheduledJob.create({
        data: { name: job.name, schedule: job.schedule, timezone: job.timezone, nextRunAt },
      });
      console.log(`[scheduler] ${job.name} first due ${nextRunAt.toISOString()}`);
      continue;
    }

    if (existing.schedule === job.schedule && existing.timezone === job.timezone) continue;

    // Keep whichever comes first, so re-pointing a schedule can bring a run
    // forward but never cancels one that is already owed.
    const recomputed = nextOccurrence(job.schedule, job.timezone, now);
    const nextRunAt = existing.nextRunAt < recomputed ? existing.nextRunAt : recomputed;
    await prisma.scheduledJob.update({
      where: { name: job.name },
      data: { schedule: job.schedule, timezone: job.timezone, nextRunAt },
    });
    console.log(
      `[scheduler] ${job.name} rescheduled from "${existing.schedule}" (${existing.timezone}); next due ${nextRunAt.toISOString()}`,
    );
  }
}

/**
 * Takes the job's lock if it is due and nothing else is running it. The where
 * clause is the whole guard: Postgres applies it as one conditional update, so
 * of two ticks arriving together — the in-process timer and the heartbeat, say
 * — exactly one gets a row back.
 */
async function claim(name: string): Promise<Date | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);

  const claimed = await prisma.scheduledJob.updateMany({
    where: {
      name,
      nextRunAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockedAt: now },
  });
  if (claimed.count === 0) return null;

  const row = await prisma.scheduledJob.findUnique({ where: { name }, select: { nextRunAt: true } });
  return row?.nextRunAt ?? null;
}

/**
 * Releases the lock and sets the next due date. Deliberately counted from now
 * rather than from the slot that was missed: a service that was down for a day
 * owes one catch-up run, not a day's worth of them back to back.
 */
async function release(job: JobDefinition, ran: boolean, error?: string): Promise<void> {
  const now = new Date();
  await prisma.scheduledJob.update({
    where: { name: job.name },
    data: {
      nextRunAt: nextOccurrence(job.schedule, job.timezone, now),
      lockedAt: null,
      ...(ran
        ? {
            lastRunAt: now,
            ...(error ? { lastError: error.slice(0, MAX_ERROR_CHARS) } : { lastSuccessAt: now, lastError: null }),
          }
        : {}),
    },
  });
}

async function runIfDue(job: JobDefinition): Promise<JobOutcome | null> {
  const dueAt = await claim(job.name);
  if (!dueAt) return null;

  const minutesLate = Math.max(0, Math.round((Date.now() - dueAt.getTime()) / 60_000));

  if (minutesLate > job.catchUpWindowMinutes) {
    console.log(`[scheduler] ${job.name} came due ${minutesLate} min ago — too late to be useful, waiting for the next slot`);
    await release(job, false);
    return { name: job.name, dueAt, minutesLate, status: 'skipped' };
  }

  if (minutesLate > 0) console.log(`[scheduler] ${job.name} catching up a run owed ${minutesLate} min ago`);

  try {
    await job.run();
    await release(job, true);
    return { name: job.name, dueAt, minutesLate, status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] ${job.name} failed:`, err);
    await release(job, true, message);
    return { name: job.name, dueAt, minutesLate, status: 'failed', error: message };
  }
}

let inFlight: Promise<JobOutcome[]> | null = null;

/**
 * Runs everything that has fallen due, one job at a time. Sequential on
 * purpose: on a free instance three syncs firing at once is how you get a
 * memory-starved container, and the jobs are not urgent to the second.
 *
 * Concurrent callers share one pass rather than queueing a second — the
 * database lock already makes a double run impossible, this just avoids the
 * pointless round trips.
 */
export function runDueJobs(): Promise<JobOutcome[]> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const outcomes: JobOutcome[] = [];
    for (const job of jobs.values()) {
      try {
        const outcome = await runIfDue(job);
        if (outcome) outcomes.push(outcome);
      } catch (err) {
        // Reaching here means the bookkeeping itself failed (the database is
        // down, most likely). Leave the row alone — the lock goes stale and
        // the job is picked up again — and let the other jobs have their turn.
        console.error(`[scheduler] could not process ${job.name}:`, err);
      }
    }
    return outcomes;
  })();

  return inFlight.finally(() => {
    inFlight = null;
  });
}

/** What every registered job is currently owed, for the status endpoint. */
export async function jobStatus() {
  const rows = await prisma.scheduledJob.findMany({ orderBy: { nextRunAt: 'asc' } });
  return rows
    .filter((row) => jobs.has(row.name))
    .map((row) => ({
      name: row.name,
      schedule: row.schedule,
      timezone: row.timezone,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      running: Boolean(row.lockedAt),
      overdueMinutes: Math.max(0, Math.round((Date.now() - row.nextRunAt.getTime()) / 60_000)),
    }));
}
