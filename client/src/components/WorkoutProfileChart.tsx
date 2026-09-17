import type { WorkoutProfileSegment } from '../api/types';
import { getTrainingZone } from '../lib/trainingZones';

// A 6-second sprint block rounds to "0min" with a flat durationSec/60 —
// show seconds instead for anything under a minute.
function formatSegmentDuration(durationSec: number): string {
  return durationSec < 60 ? `${Math.round(durationSec)}s` : `${Math.round(durationSec / 60)}min`;
}

// A short, sharp block (a 6s sprint in a 58min ride) can be well under 1% of
// the chart's width and effectively vanish. Floor it to this share instead —
// but the floored bars' extra width has to come from somewhere, or two
// consecutive short bars overlap each other (a flat per-bar min-width does
// exactly that). So every bar under the floor is set to it, and every bar
// still above the floor shrinks just enough that the whole row still sums to
// 100% with no overlap.
const MIN_WIDTH_PCT = 1.5;

function computeBarWidths(segments: WorkoutProfileSegment[], totalSec: number): number[] {
  const natural = segments.map((s) => (s.durationSec / totalSec) * 100);
  const isFloored = natural.map((w) => w < MIN_WIDTH_PCT);
  const flooredTotal = isFloored.filter(Boolean).length * MIN_WIDTH_PCT;

  // Pathological case: too many tiny segments for the floor to fit inside
  // 100% at all — split the row evenly rather than produce negative widths.
  if (flooredTotal >= 100) {
    return segments.map(() => 100 / segments.length);
  }

  const naturalRemainingTotal = natural.reduce((sum, w, i) => sum + (isFloored[i] ? 0 : w), 0);
  const shrink = naturalRemainingTotal > 0 ? (100 - flooredTotal) / naturalRemainingTotal : 0;

  return natural.map((w, i) => (isFloored[i] ? MIN_WIDTH_PCT : w * shrink));
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
  const widths = computeBarWidths(segments, totalSec);

  let cumX = 0;
  const bars = segments.map((segment, i) => {
    const widthPct = widths[i];
    const x = cumX;
    cumX += widthPct;
    const hasTarget = segment.intensityFraction != null;
    const barHeight = hasTarget
      ? Math.max(baselineHeight, (segment.intensityFraction! / maxIntensity) * height)
      : baselineHeight;
    const label = hasTarget
      ? `${formatSegmentDuration(segment.durationSec)} @ ${Math.round(segment.intensityFraction! * 100)}%`
      : formatSegmentDuration(segment.durationSec);

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
          background: hasTarget ? getTrainingZone(segment.intensityFraction!).color : 'var(--border)',
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
