import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { asString } from '../lib/params.js';

const router = Router();
router.use(requireAuth);

const goalSchema = z.object({
  title: z.string().min(1),
  targetValue: z.number(),
  currentValue: z.number().optional(),
  unit: z.string().min(1),
  deadline: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', async (req: AuthedRequest, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(goals);
});

router.post('/', async (req: AuthedRequest, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { deadline, ...data } = parsed.data;

  const goal = await prisma.goal.create({
    data: {
      ...data,
      userId: req.userId!,
      deadline: deadline ? new Date(deadline) : undefined,
    },
  });
  res.status(201).json(goal);
});

router.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = goalSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = asString(req.params.id);
  const existing = await prisma.goal.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ error: 'Goal not found' });

  const { deadline, ...data } = parsed.data;
  const goal = await prisma.goal.update({
    where: { id },
    data: {
      ...data,
      deadline: deadline ? new Date(deadline) : undefined,
    },
  });
  res.json(goal);
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.goal.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ error: 'Goal not found' });

  await prisma.goal.delete({ where: { id } });
  res.status(204).send();
});

export default router;
