import { Router, type Request } from 'express';
import { jobStatus, runDueJobs } from '../lib/scheduler.js';

/**
 * The outside world's way in to the scheduler. Something has to tick while the
 * free instance is asleep — a request to this endpoint both wakes the service
 * and asks it to make up whatever it missed. See
 * .github/workflows/sync-heartbeat.yml for what calls it.
 */
const router = Router();

/** Same shared secret the Apple Health ingest route uses; no user session here. */
function authorized(req: Request): boolean {
  const syncKey = process.env.SYNC_API_KEY;
  return Boolean(syncKey) && req.headers['x-sync-key'] === syncKey;
}

/**
 * A caller should not have to hold a connection open for a long backfill, and
 * a heartbeat that times out looks like an outage when nothing is wrong. So
 * the request waits a little for an answer worth having and then reports that
 * the work carries on without it.
 */
const AWAIT_TICK_MS = 25_000;
const STILL_RUNNING = Symbol('tick-still-running');

router.post('/tick', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Invalid or missing sync key' });

  const tick = runDueJobs();
  tick.catch((err) => console.error('[scheduler] tick failed:', err));

  const settled = await Promise.race([
    tick,
    new Promise<typeof STILL_RUNNING>((resolve) => setTimeout(() => resolve(STILL_RUNNING), AWAIT_TICK_MS)),
  ]);

  if (settled === STILL_RUNNING) return res.json({ ok: true, finished: false });
  res.json({ ok: true, finished: true, ran: settled });
});

router.get('/status', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Invalid or missing sync key' });
  res.json({ jobs: await jobStatus() });
});

export default router;
