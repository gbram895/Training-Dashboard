import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/hr-zones', async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId },
    select: { hrZone1Max: true, hrZone2Max: true, hrZone3Max: true, hrZone4Max: true },
  });
  res.json(user);
});

const hrZonesSchema = z
  .object({
    hrZone1Max: z.number().int().positive(),
    hrZone2Max: z.number().int().positive(),
    hrZone3Max: z.number().int().positive(),
    hrZone4Max: z.number().int().positive(),
  })
  .refine((v) => v.hrZone1Max < v.hrZone2Max && v.hrZone2Max < v.hrZone3Max && v.hrZone3Max < v.hrZone4Max, {
    message: 'Zone thresholds must be strictly increasing',
  });

router.put('/hr-zones', async (req: AuthedRequest, res) => {
  const parsed = hrZonesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: parsed.data,
    select: { hrZone1Max: true, hrZone2Max: true, hrZone3Max: true, hrZone4Max: true },
  });
  res.json(user);
});

router.get('/thresholds', async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  res.json(user);
});

const thresholdsSchema = z.object({
  ftpWatts: z.number().int().positive(),
  thresholdPaceSecPerKm: z.number().int().positive(),
});

router.put('/thresholds', async (req: AuthedRequest, res) => {
  const parsed = thresholdsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: parsed.data,
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  res.json(user);
});

export default router;
