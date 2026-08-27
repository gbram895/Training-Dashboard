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
import { dropboxConfigured } from './lib/dropbox.js';
import { runAllSyncs } from './lib/healthSyncJob.js';

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
});
