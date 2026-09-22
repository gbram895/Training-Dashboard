import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import authRouter from './routes/auth.js';
import workoutsRouter from './routes/workouts.js';
import goalsRouter from './routes/goals.js';
import healthRouter from './routes/health.js';
import settingsRouter from './routes/settings.js';
import workoutLibraryRouter from './routes/workoutLibrary.js';
import trainingPlanRouter from './routes/trainingPlan.js';
import pushRouter from './routes/push.js';
import cronRouter from './routes/cron.js';
import calendarRouter from './routes/calendar.js';
import { dropboxConfigured } from './lib/dropbox.js';
import { runAllSyncs } from './lib/healthSyncJob.js';
import { runAllGarminSyncs } from './lib/garminSync.js';
import { stravaConfigured } from './lib/strava.js';
import { runAllStravaSyncs } from './lib/stravaSync.js';
import { regenerateAllPlans } from './lib/trainingPlan.js';
import { pushConfigured, sendDailyWorkoutReminders, sendWeeklyAvailabilityCheckin } from './lib/webPush.js';
import { notifyAllNewLibraryWorkouts } from './lib/newWorkoutNotifications.js';
import { ALWAYS_CATCH_UP, primeJobs, registerJob, runDueJobs } from './lib/scheduler.js';

const app = express();
const PORT = process.env.PORT ?? 4000;
// Every sync cron below is scheduled in local time rather than the
// container's UTC, so an hour-of-day schedule means what it says on the
// watch that generated the data, and stays put across the CET/CEST switch.
const SYNC_TZ = process.env.SYNC_TZ ?? 'Europe/Brussels';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.get('/api/status', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/health', healthRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/workout-library', workoutLibraryRouter);
app.use('/api/training-plan', trainingPlanRouter);
app.use('/api/push', pushRouter);
app.use('/api/cron', cronRouter);
app.use('/api/calendar', calendarRouter);

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled error]', err);
  if (!res.headersSent) {
    res.status(500).send(`Server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

/**
 * Background work is scheduled by due date in the database rather than by
 * timers living in this process — see lib/scheduler.ts for why. Registering a
 * job here only says when it is owed; what actually runs it is a tick, either
 * the one below or a call to POST /api/cron/tick from outside.
 */
function registerScheduledJobs() {
  if (dropboxConfigured()) {
    registerJob({
      name: 'health-sync',
      schedule: process.env.SYNC_CRON ?? '*/30 * * * *',
      timezone: SYNC_TZ,
      run: runAllSyncs,
      catchUpWindowMinutes: ALWAYS_CATCH_UP,
      firstRun: 'now',
    });
  }

  registerJob({
    name: 'garmin-sync',
    schedule: process.env.GARMIN_SYNC_CRON ?? '*/30 * * * *',
    timezone: SYNC_TZ,
    run: runAllGarminSyncs,
    catchUpWindowMinutes: ALWAYS_CATCH_UP,
    firstRun: 'now',
  });

  if (stravaConfigured()) {
    registerJob({
      name: 'strava-sync',
      schedule: process.env.STRAVA_SYNC_CRON ?? '*/15 * * * *',
      timezone: SYNC_TZ,
      run: runAllStravaSyncs,
      catchUpWindowMinutes: ALWAYS_CATCH_UP,
      firstRun: 'now',
    });
  }

  registerJob({
    name: 'training-plan',
    schedule: process.env.TRAINING_PLAN_CRON ?? '0 4 * * *',
    timezone: SYNC_TZ,
    run: regenerateAllPlans,
    // A plan regenerated late in the day is still today's plan, so this is
    // worth catching up for most of a day — but not so long that waking up on
    // Tuesday rebuilds what was owed on Monday.
    catchUpWindowMinutes: 12 * 60,
    firstRun: 'now',
  });

  if (pushConfigured()) {
    // Scheduled after the training plan above so the day's plan is already
    // fresh by the time the notification describes it. Both are given in local
    // time (SYNC_TZ) rather than UTC, so they stay put across the CET/CEST
    // switch.
    const reminderTimezone = process.env.WORKOUT_REMINDER_TZ ?? SYNC_TZ;

    registerJob({
      name: 'push-daily-reminder',
      schedule: process.env.WORKOUT_REMINDER_CRON ?? '0 8 * * *',
      timezone: reminderTimezone,
      run: sendDailyWorkoutReminders,
      // "Today's session is ready" is worth saying a bit late and worthless by
      // the afternoon, so a badly missed morning is left to tomorrow.
      catchUpWindowMinutes: 2 * 60,
      firstRun: 'next',
    });

    // Sunday evening, local time — ahead of the week actually starting, so
    // there's time to act on it before Monday's plan is already locked in.
    registerJob({
      name: 'push-weekly-checkin',
      schedule: process.env.AVAILABILITY_CHECKIN_CRON ?? '0 18 * * 0',
      timezone: reminderTimezone,
      run: sendWeeklyAvailabilityCheckin,
      // Still Sunday evening, or not worth sending.
      catchUpWindowMinutes: 6 * 60,
      firstRun: 'next',
    });

    if (dropboxConfigured()) {
      registerJob({
        name: 'push-new-library-workouts',
        schedule: process.env.NEW_WORKOUT_CRON ?? '*/30 * * * *',
        timezone: reminderTimezone,
        run: notifyAllNewLibraryWorkouts,
        // Unlike the two reminders above, this one never goes off. They are
        // about a particular time of day and are noise once it has passed; a
        // workout file uploaded while the service was asleep is still news
        // whenever we get round to noticing it.
        catchUpWindowMinutes: ALWAYS_CATCH_UP,
        // 'next' rather than 'now' for the usual reason — a deploy should not
        // fire a push — and because the first run of all is the one that
        // establishes what "already in the library" means.
        firstRun: 'next',
      });
    }
  } else {
    console.log('[push] VAPID keys not set — daily workout reminders disabled');
  }
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  registerScheduledJobs();

  primeJobs()
    .then(() => {
      const tickSchedule = process.env.SCHEDULER_TICK_CRON ?? '* * * * *';
      cron.schedule(tickSchedule, () => {
        runDueJobs().catch((err) => console.error('[scheduler] tick failed:', err));
      });
      console.log(`[scheduler] ticking on "${tickSchedule}"`);

      // Give the process a moment to finish starting before the first pass,
      // which on a service coming back from a nap is where the catching up
      // happens.
      setTimeout(() => {
        runDueJobs().catch((err) => console.error('[scheduler] first tick failed:', err));
      }, 10_000);
    })
    .catch((err) => console.error('[scheduler] could not prepare jobs — nothing will run:', err));

  // Render's free tier spins the service down after 15 minutes with no incoming
  // requests. Pinging our own public URL well inside that window keeps it warm.
  // This only helps while the process is alive; what wakes it once it is not is
  // the heartbeat calling /api/cron/tick from outside.
  if (process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = `${process.env.RENDER_EXTERNAL_URL}/api/status`;
    cron.schedule('*/10 * * * *', () => {
      fetch(pingUrl).catch((err) => console.error('[keep-alive] ping failed:', err));
    });
    console.log(`[keep-alive] pinging ${pingUrl} every 10 minutes`);
  }
});
