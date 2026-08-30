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
import { dropboxConfigured } from './lib/dropbox.js';
import { runAllSyncs } from './lib/healthSyncJob.js';
import { runAllGarminSyncs } from './lib/garminSync.js';
import { stravaConfigured } from './lib/strava.js';
import { runAllStravaSyncs } from './lib/stravaSync.js';

const app = express();
const PORT = process.env.PORT ?? 4000;
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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  if (dropboxConfigured()) {
    const schedule = process.env.SYNC_CRON ?? '0 */6 * * *';
    cron.schedule(schedule, () => {
      runAllSyncs().catch((err) => console.error('[health-sync] run failed:', err));
    });
    console.log(`[health-sync] scheduled with cron "${schedule}"`);
    setTimeout(() => {
      runAllSyncs().catch((err) => console.error('[health-sync] initial run failed:', err));
    }, 15_000);
  }

  const garminSchedule = process.env.GARMIN_SYNC_CRON ?? '0 */6 * * *';
  cron.schedule(garminSchedule, () => {
    runAllGarminSyncs().catch((err) => console.error('[garmin-sync] run failed:', err));
  });
  console.log(`[garmin-sync] scheduled with cron "${garminSchedule}"`);
  setTimeout(() => {
    runAllGarminSyncs().catch((err) => console.error('[garmin-sync] initial run failed:', err));
  }, 20_000);

  if (stravaConfigured()) {
    const stravaSchedule = process.env.STRAVA_SYNC_CRON ?? '0 */6 * * *';
    cron.schedule(stravaSchedule, () => {
      runAllStravaSyncs().catch((err) => console.error('[strava-sync] run failed:', err));
    });
    console.log(`[strava-sync] scheduled with cron "${stravaSchedule}"`);
    setTimeout(() => {
      runAllStravaSyncs().catch((err) => console.error('[strava-sync] initial run failed:', err));
    }, 25_000);
  }

  // Render's free tier spins the service down after 15 minutes with no incoming
  // requests. Pinging our own public URL well inside that window keeps it warm.
  if (process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = `${process.env.RENDER_EXTERNAL_URL}/api/status`;
    cron.schedule('*/10 * * * *', () => {
      fetch(pingUrl).catch((err) => console.error('[keep-alive] ping failed:', err));
    });
    console.log(`[keep-alive] pinging ${pingUrl} every 10 minutes`);
  }
});
