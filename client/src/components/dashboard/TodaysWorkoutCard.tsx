import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import type { SelectedWorkout } from '../../api/types';
import { formatDuration } from '../../lib/format';
import WorkoutProfileChart from '../WorkoutProfileChart';

export default function TodaysWorkoutCard({
  workout,
  onCleared,
}: {
  workout: SelectedWorkout | null;
  onCleared: () => void;
}) {
  async function clearSelection() {
    await apiFetch('/workout-library/selected', { method: 'DELETE' });
    onCleared();
  }

  if (!workout) {
    return (
      <section className="card todays-workout-card todays-workout-empty">
        <p className="muted">
          No workout planned for today. <Link to="/plan">Pick one from your plan</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="card todays-workout-card">
      <div className="workout-card-header">
        <div>
          <p className="workout-card-eyebrow">Today's workout</p>
          <h2 className="workout-card-title">{workout.name}</h2>
          <p className="workout-card-date">
            📅 {new Date(workout.selectedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <span className={`discipline-pill discipline-${workout.discipline.toLowerCase()}`}>
          {workout.discipline === 'BIKE' ? '🚴 Bike' : '🏃 Run'}
        </span>
      </div>

      <div className="workout-stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile-label">⏱ Duration</span>
          <span className="stat-tile-value">{workout.durationMin != null ? formatDuration(workout.durationMin) : '—'}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">⏰ Training stress</span>
          <span className="stat-tile-value">{workout.trainingStress != null ? `${workout.trainingStress}/5` : '—'}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">⏰ Intensity</span>
          <span className="stat-tile-value">{workout.intensity != null ? `${workout.intensity}/5` : '—'}</span>
        </div>
      </div>

      {workout.segments && workout.segments.length > 0 && (
        <>
          <h3 className="workout-profile-heading">Workout Profile</h3>
          <WorkoutProfileChart segments={workout.segments} />
        </>
      )}

      {workout.profile && <p className="plan-card-profile">{workout.profile}</p>}
      <button type="button" className="secondary" onClick={clearSelection}>
        Clear
      </button>
    </section>
  );
}
