import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { getVapidPublicKey, pushConfigured } from '../lib/webPush.js';

const router = Router();
router.use(requireAuth);

router.get('/vapid-public-key', (_req, res) => {
  if (!pushConfigured()) return res.status(404).json({ error: 'Push notifications are not configured on this server' });
  res.json({ publicKey: getVapidPublicKey() });
});

const subscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

router.post('/subscribe', async (req: AuthedRequest, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    // A subscription's endpoint can outlive its owner reinstalling/reauthing —
    // re-point it at whoever just subscribed with it rather than erroring.
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ subscribed: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().min(1) });

router.delete('/subscribe', async (req: AuthedRequest, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.pushSubscription.deleteMany({ where: { userId: req.userId, endpoint: parsed.data.endpoint } });
  res.json({ subscribed: false });
});

export default router;
