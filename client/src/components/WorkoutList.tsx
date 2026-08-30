import { Link } from 'react-router-dom';
import type { Workout } from '../api/types';
import { formatDateUTC, formatDistance, formatDuration, formatPace, formatSpeed } from '../lib/format';

function paceOrSpeed(w: Workout): string | null {
  if (!w.distanceKm) return null;
  if (w.type === 'RUN' || w.type === 'WALK') return formatPace(w.durationMin, w.distanceKm);
  if (w.type === 'RIDE') return formatSpeed(w.durationMin, w.distanceKm);
  return null;
}

export default function WorkoutList({
  workouts,
  labels,
}: {
  workouts: Workout[];
  labels: Record<string, string>;
}) {
  return (
    <ul className="workout-list">
      {workouts.map((w) => {
        const pace = paceOrSpeed(w);
        return (
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
                {pace ? <span>{pace}</span> : null}
                {w.calorieKcal ? <span>{Math.round(w.calorieKcal)} kcal</span> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
