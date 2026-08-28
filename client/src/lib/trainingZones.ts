export interface TrainingZone {
  label: string;
  color: string;
  cardColor: string;
  rpe: string;
}

// Standard power-zone cutoffs: Z1 Recovery <=55%, Z2 Endurance 56-75%,
// Z3 Tempo 76-90%, Z4 Threshold 91-105%, Z5 VO2max+ >105%. RPE ranges
// follow the same zones on the Borg CR10 scale. `cardColor` is a darker
// step of the same hue - the thin profile-chart bars use `color` on a
// light surface, but a segment card carries white text on the fill
// itself, which the lighter step doesn't have enough contrast for.
const ZONES: TrainingZone[] = [
  { label: 'Recovery', color: 'var(--chart-z1)', cardColor: 'var(--chart-z1-dark)', rpe: '2-3' },
  { label: 'Endurance', color: 'var(--chart-z2)', cardColor: 'var(--chart-z2-dark)', rpe: '4-6' },
  { label: 'Tempo', color: 'var(--chart-z3)', cardColor: 'var(--chart-z3-dark)', rpe: '7-8' },
  { label: 'Threshold', color: 'var(--chart-z4)', cardColor: 'var(--chart-z4-dark)', rpe: '9' },
  { label: 'VO2max', color: 'var(--chart-z5)', cardColor: 'var(--chart-z5-dark)', rpe: '10' },
];

export function getTrainingZone(intensityFraction: number): TrainingZone {
  if (intensityFraction <= 0.55) return ZONES[0];
  if (intensityFraction <= 0.75) return ZONES[1];
  if (intensityFraction <= 0.9) return ZONES[2];
  if (intensityFraction <= 1.05) return ZONES[3];
  return ZONES[4];
}
