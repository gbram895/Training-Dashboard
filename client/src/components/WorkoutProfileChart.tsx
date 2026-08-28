import type { WorkoutProfileSegment } from '../api/types';

const ZONE_COLORS = ['var(--chart-z1)', 'var(--chart-z2)', 'var(--chart-z3)', 'var(--chart-z4)', 'var(--chart-z5)'];

// Standard power-zone cutoffs: Z1 Recovery <=55%, Z2 Endurance 56-75%,
// Z3 Tempo 76-90%, Z4 Threshold 91-105%, Z5 VO2max+ >105%.
function zoneColor(intensityFraction: number): string {
  if (intensityFraction <= 0.55) return ZONE_COLORS[0];
  if (intensityFraction <= 0.75) return ZONE_COLORS[1];
  if (intensityFraction <= 0.9) return ZONE_COLORS[2];
  if (intensityFraction <= 1.05) return ZONE_COLORS[3];
  return ZONE_COLORS[4];
}

export default function WorkoutProfileChart({
  segments,
  height = 110,
}: {
  segments: WorkoutProfileSegment[];
  height?: number;
}) {
  const totalSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
  if (totalSec <= 0) return null;

  const maxIntensity = Math.max(1, ...segments.map((s) => s.intensityFraction ?? 0));
  const baselineHeight = height * 0.12;
  const gap = 1;

  let cumX = 0;
  const bars = segments.map((segment, i) => {
    const widthPct = (segment.durationSec / totalSec) * 100;
    const x = cumX;
    cumX += widthPct;
    const hasTarget = segment.intensityFraction != null;
    const barHeight = hasTarget
      ? Math.max(baselineHeight, (segment.intensityFraction! / maxIntensity) * height)
      : baselineHeight;
    const label = hasTarget
      ? `${Math.round(segment.durationSec / 60)}min @ ${Math.round(segment.intensityFraction! * 100)}%`
      : `${Math.round(segment.durationSec / 60)}min`;

    return (
      <div
        key={i}
        title={label}
        style={{
          position: 'absolute',
          left: `${x}%`,
          width: `calc(${widthPct}% - ${gap}px)`,
          bottom: 0,
          height: barHeight,
          background: hasTarget ? zoneColor(segment.intensityFraction!) : 'var(--border)',
          borderRadius: '2px 2px 0 0',
        }}
      />
    );
  });

  return (
    <div className="workout-profile-chart" style={{ height }}>
      {bars}
    </div>
  );
}
