import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { getPlannedDay } from '../lib/trainingPlan.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

const router = Router();
router.use(requireAuth);

// The Home Screen widget (see ios-widget/) runs unattended and has no way to
// go through the normal login flow to refresh an expired token, so it gets
// its own long-lived one rather than reusing the 30-day session token — a
// year is long enough that re-pasting it into the widget script is a once-
// in-a-while chore, not a monthly one. It authenticates exactly like any
// other token from here (requireAuth doesn't distinguish them), so it's
// still full API access under the hood — treat it like a password.
router.post('/token', (req: AuthedRequest, res) => {
  const token = jwt.sign({ userId: req.userId }, JWT_SECRET!, { expiresIn: '400d' });
  res.json({ token });
});

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Deliberately minimal — just what a small Home Screen tile can show at a
// glance. Anything richer (segments, pace/power targets) belongs in the app.
router.get('/today', async (req: AuthedRequest, res) => {
  const today = utcMidnight(new Date());
  const day = await getPlannedDay(req.userId!, today);
  const date = today.toISOString().slice(0, 10);

  if (!day) {
    return res.json({ date, hasPlan: false });
  }

  res.json({
    date,
    hasPlan: true,
    isRestDay: day.isRestDay,
    restReason: day.restReason,
    name: day.name,
    discipline: day.discipline,
    durationMin: day.durationMin,
    intensity: day.intensity,
    trainingStress: day.trainingStress,
    category: day.category,
    focus: day.focus,
  });
});

export default router;
