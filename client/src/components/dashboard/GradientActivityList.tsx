import { Link } from 'react-router-dom';
import type { Workout, WorkoutType } from '../../api/types';
import { formatDistance, formatDuration, formatRelativeDay } from '../../lib/format';

export const TYPE_ICON: Record<WorkoutType, string> = {
  RUN: '🏃',
  RIDE: '🚴',
  SWIM: '🏊',
  STRENGTH: '🏋️',
  WALK: '🚶',
  BADMINTON: '🏸',
  OTHER: '🏅',
};

export const TYPE_LABEL: Record<WorkoutType, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  SWIM: 'Swim',
  STRENGTH: 'Strength',
  WALK: 'Walk',
  BADMINTON: 'Badminton',
  OTHER: 'Workout',
};

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
            <p className="gd-a-title">{TYPE_LABEL[w.type]}</p>
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
