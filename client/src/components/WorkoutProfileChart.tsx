import type { WorkoutProfileSegment } from '../api/types';
import { getTrainingZone } from '../lib/trainingZones';

// A 6-second sprint block rounds to "0min" with a flat durationSec/60 —
// show seconds instead for anything under a minute.
function formatSegmentDuration(durationSec: number): string {
  return durationSec < 60 ? `${Math.round(durationSec)}s` : `${Math.round(durationSec / 60)}min`;
}

// Pure linear width (durationSec / total) makes a 6s sprint in a 58min ride
// under 0.2% wide — invisible. A flat minimum width fixed that but broke
// proportion the other way: every short segment rendered the same width
// regardless of whether it was 5s or 30s, and a 5s block could end up
// looking like a fifth the width of a 5min one (should be ~1/60th).
//
// Power scaling (weight = durationSec^WIDTH_POWER) is the standard fix for
// this — the same trick bubble charts use so area doesn't misrepresent
// magnitude at the extremes. It keeps every segment's width honestly
// ordered and distinct (a 5s and 15s segment no longer render identically),
// compresses the range enough that short segments stay visible, and leaves
// same-duration segments exactly as wide as each other either way.
//
// 0.5 (sqrt) still rendered short sprint blocks noticeably too wide next to
// longer threshold/endurance blocks — at 0.5 a 5min block is only ~5x a 5s
// block's width, when the true ratio is 60x. 0.75 pushes much closer to
// true proportion (~11x) while still keeping sub-10s efforts a few px wide
// instead of sub-pixel invisible.
const WIDTH_POWER = 0.75;

function computeBarWidths(segments: WorkoutProfileSegment[]): number[] {
  const weights = segments.map((s) => Math.max(0, s.durationSec) ** WIDTH_POWER);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return segments.map(() => 100 / segments.length);
  return weights.map((w) => (w / total) * 100);
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
  const widths = computeBarWidths(segments);

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
