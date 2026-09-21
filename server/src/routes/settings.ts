import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { recomputeAllTrainingLoad } from '../lib/trainingLoad.js';
import { buildCalibrationReport } from '../lib/calibration.js';
import { generatePlanWindow } from '../lib/trainingPlan.js';

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
  // Zone boundaries are baked into every workout's stored time-in-zone, and
  // into the HR-derived training load computed from it, so a change here has
  // to be applied backwards over the athlete's history or the fitness curve
  // ends up half on the old zones and half on the new.
  await applyThresholdChange(req.userId!);
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
  await applyThresholdChange(req.userId!);
  res.json(user);
});

/**
 * Every TSS in the app is an effort measured against these thresholds, so
 * changing one silently invalidates the athlete's whole history: Fitness,
 * Fatigue, Form, the readiness ring and today's planned session all move.
 * Recomputing here is what keeps the curve internally consistent.
 */
async function applyThresholdChange(userId: string): Promise<number> {
  const recomputed = await recomputeAllTrainingLoad(userId);
  await generatePlanWindow(userId).catch((err) =>
    console.error('[settings] plan regeneration after threshold change failed:', err),
  );
  return recomputed;
}

// What the athlete's own data says their thresholds should be. Read-only —
// nothing is written until they accept a suggestion below.
router.get('/calibration', async (req: AuthedRequest, res) => {
  res.json(await buildCalibrationReport(req.userId!));
});

const applySchema = z
  .object({
    ftpWatts: z.number().int().positive().optional(),
    thresholdPaceSecPerKm: z.number().int().positive().optional(),
    hrZones: z
      .object({
        hrZone1Max: z.number().int().positive(),
        hrZone2Max: z.number().int().positive(),
        hrZone3Max: z.number().int().positive(),
        hrZone4Max: z.number().int().positive(),
      })
      .refine(
        (v) => v.hrZone1Max < v.hrZone2Max && v.hrZone2Max < v.hrZone3Max && v.hrZone3Max < v.hrZone4Max,
        { message: 'Zone thresholds must each be higher than the last' },
      )
      .optional(),
  })
  .refine((v) => v.ftpWatts != null || v.thresholdPaceSecPerKm != null || v.hrZones != null, {
    message: 'Nothing to apply',
  });

router.post('/calibration/apply', async (req: AuthedRequest, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { hrZones, ...thresholds } = parsed.data;
  await prisma.user.update({
    where: { id: req.userId },
    data: { ...thresholds, ...(hrZones ?? {}) },
  });

  const recomputed = await applyThresholdChange(req.userId!);
  res.json({ recomputed, calibration: await buildCalibrationReport(req.userId!) });
});

export default router;
