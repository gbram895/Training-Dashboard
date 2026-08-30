import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import type { PlannedDay, SelectedWorkout } from '../../api/types';
import { formatDuration } from '../../lib/format';
import BarScale from '../BarScale';
import WorkoutProfileChart from '../WorkoutProfileChart';

export default function TodaysWorkoutCard({
  workout,
  plannedToday,
  onCleared,
}: {
  workout: SelectedWorkout | null;
  plannedToday: PlannedDay | null;
  onCleared: () => void;
}) {
  const navigate = useNavigate();

  async function clearSelection() {
    await apiFetch('/workout-library/selected', { method: 'DELETE' });
    onCleared();
  }

  if (!workout && plannedToday?.isRestDay) {
    return (
      <section className="card todays-workout-card">
        <p className="workout-card-eyebrow">Today's plan</p>
        <h2 className="workout-card-title">Rest day 😌</h2>
        <p className="muted">{plannedToday.restReason ?? 'No training scheduled today — recover up.'}</p>
      </section>
    );
  }

  if (!workout && plannedToday) {
    return (
      <section className="card todays-workout-card todays-workout-clickable" onClick={() => navigate('/plan/today')}>
        <div className="workout-card-header">
          <div>
            <p className="workout-card-eyebrow">Today's plan</p>
            <h2 className="workout-card-title">{plannedToday.name}</h2>
          </div>
          <span className={`discipline-pill discipline-${(plannedToday.discipline ?? 'bike').toLowerCase()}`}>
            {plannedToday.discipline === 'RUN' ? '🏃 Run' : '🚴 Bike'}
          </span>
        </div>

        <div className="workout-stat-tiles">
          <div className="workout-stat">
            <span className="workout-stat-value">
              {plannedToday.durationMin != null ? formatDuration(plannedToday.durationMin) : '—'}
            </span>
            <span className="workout-stat-label">Duration</span>
          </div>
          <div className="workout-stat">
            {plannedToday.trainingStress != null ? (
              <BarScale value={plannedToday.trainingStress} />
            ) : (
              <span className="workout-stat-value">—</span>
            )}
            <span className="workout-stat-label">Training stress</span>
          </div>
          <div className="workout-stat">
            {plannedToday.intensity != null ? (
              <BarScale value={plannedToday.intensity} />
            ) : (
              <span className="workout-stat-value">—</span>
            )}
            <span className="workout-stat-label">Intensity</span>
          </div>
        </div>

        {plannedToday.segments && plannedToday.segments.length > 0 && (
          <>
            <h3 className="workout-profile-heading">Workout Profile</h3>
            <WorkoutProfileChart segments={plannedToday.segments} />
          </>
        )}

        {plannedToday.profile && <p className="plan-card-profile">{plannedToday.profile}</p>}
      </section>
    );
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
    <section className="card todays-workout-card todays-workout-clickable" onClick={() => navigate('/plan/today')}>
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
        <div className="workout-stat">
          <span className="workout-stat-value">{workout.durationMin != null ? formatDuration(workout.durationMin) : '—'}</span>
          <span className="workout-stat-label">Duration</span>
        </div>
        <div className="workout-stat">
          {workout.trainingStress != null ? <BarScale value={workout.trainingStress} /> : <span className="workout-stat-value">—</span>}
          <span className="workout-stat-label">Training stress</span>
        </div>
        <div className="workout-stat">
          {workout.intensity != null ? <BarScale value={workout.intensity} /> : <span className="workout-stat-value">—</span>}
          <span className="workout-stat-label">Intensity</span>
        </div>
      </div>

      {workout.segments && workout.segments.length > 0 && (
        <>
          <h3 className="workout-profile-heading">Workout Profile</h3>
          <WorkoutProfileChart segments={workout.segments} />
        </>
      )}

      {workout.profile && <p className="plan-card-profile">{workout.profile}</p>}
      <button
        type="button"
        className="secondary"
        onClick={(e) => {
          e.stopPropagation();
          clearSelection();
        }}
      >
        Clear
      </button>
    </section>
  );
}
