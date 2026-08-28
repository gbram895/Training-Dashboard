import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import type { SelectedWorkout } from '../../api/types';
import { formatDuration } from '../../lib/format';

function DotScale({ value, max = 5 }: { value?: number | null; max?: number }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="dot-scale">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`dot${i < value ? ' filled' : ''}`} />
      ))}
    </span>
  );
}

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
      <div className="card-header-row">
        <h2>Today’s workout: {workout.name}</h2>
        <span className={`discipline-badge discipline-${workout.discipline.toLowerCase()}`}>
          {workout.discipline === 'BIKE' ? 'Bike' : 'Run'}
        </span>
      </div>
      <div className="plan-card-stats">
        <div>
          <span className="muted">Duration</span>
          <span>{workout.durationMin != null ? formatDuration(workout.durationMin) : '—'}</span>
        </div>
        <div>
          <span className="muted">Intensity</span>
          <DotScale value={workout.intensity} />
        </div>
        <div>
          <span className="muted">Training stress</span>
          <DotScale value={workout.trainingStress} />
        </div>
      </div>
      {workout.profile && <p className="plan-card-profile">{workout.profile}</p>}
      <button type="button" className="secondary" onClick={clearSelection}>
        Clear
      </button>
    </section>
  );
}
