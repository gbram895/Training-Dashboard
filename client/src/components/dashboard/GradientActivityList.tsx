import { Link } from 'react-router-dom';
import type { Workout } from '../../api/types';
import { formatDistance, formatDuration, formatRelativeDay } from '../../lib/format';
import { TYPE_ICON, TYPE_LABEL } from '../../lib/workoutTypes';

export default function GradientActivityList({ workouts }: { workouts: Workout[] }) {
  if (workouts.length === 0) {
    return <p className="muted">No workouts logged yet.</p>;
  }

  return (
    <>
      {workouts.map((w) => (
        <Link key={w.id} to={`/workouts/${w.id}`} className="gd-activity-card">
          <div className="gd-activity-icon">{TYPE_ICON[w.type]}</div>
          <div className="gd-activity-info">
            {/* The icon already says which discipline it was, so a named
                activity spends the heading on its name instead. */}
            <p className="gd-a-title">{w.title?.trim() || TYPE_LABEL[w.type]}</p>
            <p className="gd-a-meta">
              {formatRelativeDay(w.date)} · {formatDuration(w.durationMin)}
              {w.distanceKm ? ` · ${formatDistance(w.distanceKm)}` : ''}
            </p>
          </div>
          {(w.tss != null || w.rpe != null) && (
            <div className="gd-activity-stats">
              {w.tss != null && <span className="gd-activity-tss mono">TSS {Math.round(w.tss)}</span>}
              {w.rpe != null && <span className="gd-activity-rpe mono">RPE {w.rpe}</span>}
            </div>
          )}
        </Link>
      ))}
    </>
  );
}
