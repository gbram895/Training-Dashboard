import { prisma } from './prisma.js';

export interface FitnessPoint {
  date: string; // YYYY-MM-DD
  ctl: number; // Chronic Training Load ("Fitness") — 42-day EWMA of daily TSS
  atl: number; // Acute Training Load ("Fatigue") — 7-day EWMA of daily TSS
  tsb: number; // Training Stress Balance ("Form") — yesterday's CTL minus yesterday's ATL
}

const CTL_TIME_CONSTANT = 42;
const ATL_TIME_CONSTANT = 7;
const DAYS_RETURNED = 180;

/**
 * TrainingPeaks-style Performance Management Chart series. TSB for a given day
 * reflects the athlete's freshness going INTO that day — i.e. it's computed from
 * the previous day's CTL/ATL, before that day's own training is folded in. CTL
 * and ATL themselves include the current day.
 */
export async function computeFitnessSeries(userId: string): Promise<FitnessPoint[]> {
  const workouts = await prisma.workout.findMany({
    where: { userId, tss: { not: null } },
    select: { date: true, tss: true },
    orderBy: { date: 'asc' },
  });
  if (workouts.length === 0) return [];

  const dailyTss = new Map<string, number>();
  for (const w of workouts) {
    const key = w.date.toISOString().slice(0, 10);
    dailyTss.set(key, (dailyTss.get(key) ?? 0) + (w.tss ?? 0));
  }

  const firstDate = new Date(`${workouts[0].date.toISOString().slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const ctlDecay = 1 - Math.exp(-1 / CTL_TIME_CONSTANT);
  const atlDecay = 1 - Math.exp(-1 / ATL_TIME_CONSTANT);

  const series: FitnessPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (let d = new Date(firstDate); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const tsb = ctl - atl;

    const tss = dailyTss.get(key) ?? 0;
    ctl = ctl + (tss - ctl) * ctlDecay;
    atl = atl + (tss - atl) * atlDecay;

    series.push({
      date: key,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
    });
  }

  return series.slice(-DAYS_RETURNED);
}
