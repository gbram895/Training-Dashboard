import { prisma } from './prisma.js';
import {
  aggregateHealthExports,
  computeHrZoneMinutes,
  externalWorkoutId,
  mapWorkoutType,
  type HealthAutoExportFile,
} from './appleHealth.js';

export async function applyHealthFiles(userId: string, files: HealthAutoExportFile[]) {
  const daily = aggregateHealthExports(files);
  for (const day of daily) {
    await prisma.dailyHealthSummary.upsert({
      where: { userId_date: { userId, date: new Date(day.date) } },
      create: { ...day, date: new Date(day.date), userId },
      update: { ...day, date: new Date(day.date) },
    });
  }

  const hasWorkouts = files.some((f) => (f.data.workouts?.length ?? 0) > 0);
  const user = hasWorkouts
    ? await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { hrZone1Max: true, hrZone2Max: true, hrZone3Max: true, hrZone4Max: true },
      })
    : null;
  const thresholds = user && {
    z1Max: user.hrZone1Max,
    z2Max: user.hrZone2Max,
    z3Max: user.hrZone3Max,
    z4Max: user.hrZone4Max,
  };

  let workoutsImported = 0;
  for (const file of files) {
    for (const workout of file.data.workouts ?? []) {
      const externalId = externalWorkoutId(workout);
      const type = mapWorkoutType(workout.name);
      const durationMin = workout.duration
        ? Math.round(workout.duration / 60)
        : Math.round((new Date(workout.end).getTime() - new Date(workout.start).getTime()) / 60000);
      const distanceKm = workout.distance?.units === 'km' ? workout.distance.qty : undefined;
      const zones = thresholds
        ? computeHrZoneMinutes(workout.heartRateData, workout.end, thresholds)
        : null;
      const zoneFields = {
        hrZone1Min: zones?.z1,
        hrZone2Min: zones?.z2,
        hrZone3Min: zones?.z3,
        hrZone4Min: zones?.z4,
        hrZone5Min: zones?.z5,
      };

      let workoutId: string;
      const existing = await prisma.workout.findUnique({ where: { externalId } });
      if (existing) {
        await prisma.workout.update({
          where: { externalId },
          data: {
            type,
            durationMin,
            distanceKm,
            notes: type === 'OTHER' && !existing.notes ? workout.name : undefined,
            ...zoneFields,
          },
        });
        workoutId = existing.id;
      } else {
        const created = await prisma.workout.create({
          data: {
            userId,
            type,
            date: new Date(workout.start),
            durationMin,
            distanceKm,
            notes: type === 'OTHER' ? workout.name : undefined,
            source: 'apple_health',
            externalId,
            ...zoneFields,
          },
        });
        workoutId = created.id;
      }

      if (workout.heartRateData?.length) {
        const startMs = new Date(workout.start).getTime();
        const samples = workout.heartRateData
          .filter((s): s is typeof s & { Avg: number } => s.Avg != null)
          .map((s) => ({
            workoutId,
            offsetSec: Math.round((new Date(s.date).getTime() - startMs) / 1000),
            heartRate: Math.round(s.Avg),
          }));
        if (samples.length > 0) {
          await prisma.workoutSample.deleteMany({ where: { workoutId } });
          await prisma.workoutSample.createMany({ data: samples });
        }
      }

      workoutsImported += 1;
    }
  }

  return { daysImported: daily.length, workoutsImported };
}
