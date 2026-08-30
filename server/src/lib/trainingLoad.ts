import { prisma } from './prisma.js';

interface PowerSample {
  offsetSec: number;
  powerWatts: number | null;
}

// Total mechanical work done, in kilojoules — the integral of power over time.
// Skips gaps longer than 30s (paused recording) so a stopped ride doesn't get
// credited with phantom work for the time it sat idle.
export function computeKilojoules(samples: PowerSample[]): number | null {
  const withPower = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (withPower.length < 2) return null;

  let joules = 0;
  for (let i = 1; i < withPower.length; i++) {
    const dt = withPower[i].offsetSec - withPower[i - 1].offsetSec;
    if (dt <= 0 || dt > 30) continue;
    joules += withPower[i].powerWatts * dt;
  }
  return joules > 0 ? joules / 1000 : null;
}

// Coggan-style TSS from a power stream: 30-sample rolling average -> 4th-power
// mean -> 4th root gives normalized power; TSS scales duration by how hard NP
// was relative to FTP. Assumes ~1 sample/sec, which is what Garmin and Strava
// both stream at.
export function computeRideTss(samples: PowerSample[], ftpWatts: number): number | null {
  if (!ftpWatts) return null;
  const withPower = samples
    .filter((s): s is { offsetSec: number; powerWatts: number } => s.powerWatts != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (withPower.length < 30) return null;

  const window = 30;
  const rolling: number[] = [];
  const queue: number[] = [];
  let sum = 0;
  for (const { powerWatts } of withPower) {
    queue.push(powerWatts);
    sum += powerWatts;
    if (queue.length > window) sum -= queue.shift()!;
    rolling.push(sum / queue.length);
  }

  const avgFourthPower = rolling.reduce((acc, p) => acc + p ** 4, 0) / rolling.length;
  const normalizedPower = avgFourthPower ** 0.25;
  const intensityFactor = normalizedPower / ftpWatts;
  const durationSec = withPower[withPower.length - 1].offsetSec - withPower[0].offsetSec;
  if (durationSec <= 0) return null;

  return ((durationSec * normalizedPower * intensityFactor) / (ftpWatts * 3600)) * 100;
}

// Pace-based TSS (the running equivalent of the Ride formula above), derived
// from the average pace over the whole activity rather than a sample stream —
// so this works even for workouts with no per-second data at all.
export function computeRunTss(durationMin: number, distanceKm: number, thresholdPaceSecPerKm: number): number | null {
  if (!distanceKm || !thresholdPaceSecPerKm || !durationMin) return null;
  const avgPaceSecPerKm = (durationMin * 60) / distanceKm;
  const intensityFactor = thresholdPaceSecPerKm / avgPaceSecPerKm;
  const durationSec = durationMin * 60;
  return ((durationSec * intensityFactor ** 2) / 3600) * 100;
}

/** Recomputes and persists kilojoules + TSS for a workout from its current samples and the user's current FTP/threshold pace. */
export async function recomputeTrainingLoad(workoutId: string): Promise<void> {
  const workout = await prisma.workout.findUnique({ where: { id: workoutId }, include: { samples: true } });
  if (!workout) return;

  const user = await prisma.user.findUnique({
    where: { id: workout.userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  if (!user) return;

  let kilojoules: number | null = null;
  let tss: number | null = null;

  if (workout.type === 'RIDE') {
    kilojoules = computeKilojoules(workout.samples);
    tss = computeRideTss(workout.samples, user.ftpWatts);
  } else if (workout.type === 'RUN') {
    tss = computeRunTss(workout.durationMin, workout.distanceKm ?? 0, user.thresholdPaceSecPerKm);
  }

  await prisma.workout.update({ where: { id: workoutId }, data: { kilojoules, tss } });
}
