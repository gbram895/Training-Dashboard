import { Link } from 'react-router-dom';
import type { Workout } from '../api/types';
import { formatDateUTC, formatDistance, formatDuration } from '../lib/format';

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
              <span className="workout-type">
                {w.type === 'OTHER' && w.notes ? w.notes : (labels[w.type] ?? w.type)}
              </span>
              <span className="muted">
                {' '}
                · {formatDateUTC(w.date)}
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
