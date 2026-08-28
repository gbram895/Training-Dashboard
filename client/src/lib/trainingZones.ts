export interface TrainingZone {
  label: string;
  color: string;
  textColor: string;
  rpe: string;
}

// Standard power-zone cutoffs: Z1 Recovery <=55%, Z2 Endurance 56-75%,
// Z3 Tempo 76-90%, Z4 Threshold 91-105%, Z5 VO2max+ >105%. RPE ranges
// follow the same zones on the Borg CR10 scale. `color` is the same zone
// color used by the workout profile chart's bars, so a segment card and
// the bar it corresponds to always match exactly; `textColor` switches to
// dark ink on the two lightest zones (Recovery, Threshold) where white
// text would be too low-contrast to read.
const ZONES: TrainingZone[] = [
  { label: 'Recovery', color: 'var(--chart-z1)', textColor: 'var(--text)', rpe: '2-3' },
  { label: 'Endurance', color: 'var(--chart-z2)', textColor: '#fff', rpe: '4-6' },
  { label: 'Tempo', color: 'var(--chart-z3)', textColor: '#fff', rpe: '7-8' },
  { label: 'Threshold', color: 'var(--chart-z4)', textColor: 'var(--text)', rpe: '9' },
  { label: 'VO2max', color: 'var(--chart-z5)', textColor: '#fff', rpe: '10' },
];

export function getTrainingZone(intensityFraction: number): TrainingZone {
  if (intensityFraction <= 0.55) return ZONES[0];
  if (intensityFraction <= 0.75) return ZONES[1];
  if (intensityFraction <= 0.9) return ZONES[2];
  if (intensityFraction <= 1.05) return ZONES[3];
  return ZONES[4];
}
