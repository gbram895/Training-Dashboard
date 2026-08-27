import { prisma } from './prisma.js';
import {
  aggregateHealthExports,
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

  let workoutsImported = 0;
  for (const file of files) {
    for (const workout of file.data.workouts ?? []) {
      const externalId = externalWorkoutId(workout);
      const type = mapWorkoutType(workout.name);
      const durationMin = workout.duration
        ? Math.round(workout.duration / 60)
        : Math.round((new Date(workout.end).getTime() - new Date(workout.start).getTime()) / 60000);
      const distanceKm = workout.distance?.units === 'km' ? workout.distance.qty : undefined;

      const existing = await prisma.workout.findUnique({ where: { externalId } });
      if (existing) {
        await prisma.workout.update({
          where: { externalId },
          data: {
            durationMin,
            distanceKm,
            notes: type === 'OTHER' && !existing.notes ? workout.name : undefined,
          },
        });
      } else {
        await prisma.workout.create({
          data: {
            userId,
            type,
            date: new Date(workout.start),
            durationMin,
            distanceKm,
            notes: type === 'OTHER' ? workout.name : undefined,
            source: 'apple_health',
            externalId,
          },
        });
      }
      workoutsImported += 1;
    }
  }

  return { daysImported: daily.length, workoutsImported };
}
