import type { WorkoutType } from '@prisma/client';
import { prisma } from './prisma.js';

// Garmin auto-uploads to Strava, and a phone's Apple Health can log the same
// session a watch already recorded — so the same real-world activity can arrive
// from more than one source. Treat two workouts of the same type starting within
// this many minutes of each other as the same activity.
const DUPLICATE_WINDOW_MIN = 15;

interface SampleLike {
  heartRate?: number | null;
  speedMps?: number | null;
  powerWatts?: number | null;
}

interface IncomingSample extends SampleLike {
  offsetSec: number;
}

// Power > speed > heart-rate-only, since that's the order in which a source
// typically adds fidelity; sample count breaks ties between two sources that
// otherwise recorded the same fields.
function richnessScore(samples: SampleLike[]): number {
  let hasPower = false;
  let hasSpeed = false;
  let hasHeartRate = false;
  for (const s of samples) {
    if (s.powerWatts != null) hasPower = true;
    if (s.speedMps != null) hasSpeed = true;
    if (s.heartRate != null) hasHeartRate = true;
  }
  return (hasPower ? 100 : 0) + (hasSpeed ? 10 : 0) + (hasHeartRate ? 1 : 0) + samples.length / 1_000_000;
}

export interface IncomingWorkout {
  userId: string;
  type: WorkoutType;
  date: Date;
  durationMin: number;
  distanceKm?: number;
  notes?: string;
  source: string;
  externalId: string;
  calorieKcal?: number;
  zoneFields?: Record<string, number | undefined>;
  samples: IncomingSample[];
}

export interface DedupResult {
  outcome: 'created' | 'replaced-duplicate' | 'skipped-duplicate';
  workoutId: string | null;
}

/**
 * Creates a workout from a newly-synced activity, unless a richer copy of the
 * same real-world activity already exists from a different source — in which
 * case this is a no-op — or a poorer copy exists, in which case it replaces it.
 * Callers should only reach this after confirming no workout already has this
 * exact externalId (that case is a same-source re-sync, handled by the caller).
 */
export async function createDedupedWorkout(incoming: IncomingWorkout): Promise<DedupResult> {
  const windowStart = new Date(incoming.date.getTime() - DUPLICATE_WINDOW_MIN * 60_000);
  const windowEnd = new Date(incoming.date.getTime() + DUPLICATE_WINDOW_MIN * 60_000);

  const duplicate = await prisma.workout.findFirst({
    where: { userId: incoming.userId, type: incoming.type, date: { gte: windowStart, lte: windowEnd } },
    include: { samples: true },
  });

  if (duplicate) {
    if (richnessScore(incoming.samples) <= richnessScore(duplicate.samples)) {
      return { outcome: 'skipped-duplicate', workoutId: null };
    }
    await prisma.workout.delete({ where: { id: duplicate.id } });
  }

  const workout = await prisma.workout.create({
    data: {
      userId: incoming.userId,
      type: incoming.type,
      date: incoming.date,
      durationMin: incoming.durationMin,
      distanceKm: incoming.distanceKm,
      notes: incoming.notes,
      source: incoming.source,
      externalId: incoming.externalId,
      calorieKcal: incoming.calorieKcal,
      ...incoming.zoneFields,
    },
  });

  if (incoming.samples.length > 0) {
    await prisma.workoutSample.createMany({
      data: incoming.samples.map((s) => ({ workoutId: workout.id, ...s })),
    });
  }

  return { outcome: duplicate ? 'replaced-duplicate' : 'created', workoutId: workout.id };
}
