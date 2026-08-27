import { Link } from 'react-router-dom';
import type { Workout } from '../api/types';
import { formatDistance, formatDuration } from '../lib/format';

export default function WorkoutList({
  workouts,
  labels,
}: {
  workouts: Workout[];
  labels: Record<string, string>;
}) {
  return (
    <ul className="workout-list">
      {workouts.map((w) => (
        <li key={w.id}>
          <Link to={`/workouts/${w.id}`} className="workout-row">
            <div>
              <span className="workout-type">{labels[w.type] ?? w.type}</span>
              <span className="muted">
                {' '}
                · {new Date(w.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="workout-meta">
              <span>{formatDuration(w.durationMin)}</span>
              {w.distanceKm ? <span>{formatDistance(w.distanceKm)}</span> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
