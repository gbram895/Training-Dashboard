import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { LibraryWorkout, SelectedWorkout } from '../api/types';
import { formatDuration } from '../lib/format';

function DotScale({ value, max = 5 }: { value?: number; max?: number }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="dot-scale">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`dot${i < value ? ' filled' : ''}`} />
      ))}
    </span>
  );
}

export default function Plan() {
  const [workouts, setWorkouts] = useState<LibraryWorkout[] | null>(null);
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingPath, setSelectingPath] = useState<string | null>(null);

  function load() {
    apiFetch<LibraryWorkout[]>('/workout-library')
      .then((data) => {
        setWorkouts(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load workout library'));
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setSelected);
  }

  useEffect(load, []);

  async function selectWorkout(w: LibraryWorkout) {
    setSelectingPath(w.path);
    try {
      const result = await apiFetch<SelectedWorkout>('/workout-library/select', {
        method: 'POST',
        body: JSON.stringify(w),
      });
      setSelected(result);
    } finally {
      setSelectingPath(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Plan</h1>
      </header>

      {error ? (
        <p className="muted">{error}</p>
      ) : workouts === null ? (
        <p className="muted">Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="muted">
          No workouts found. Add text files to a "Workout Database" folder in your Dropbox — one workout per file,
          e.g.:
          <br />
          <code>
            Name: Zone 2 Endurance Ride
            <br />
            Type: Bike
            <br />
            Duration: 90
            <br />
            Intensity: 2<br />
            Training Stress: 3<br />
            Profile: Steady zone 2 effort, keep HR under 145bpm.
          </code>
        </p>
      ) : (
        <div className="plan-grid">
          {workouts.map((w) => {
            const isSelected = selected?.sourcePath === w.path;
            return (
              <div className={`card plan-card${isSelected ? ' plan-card-selected' : ''}`} key={w.path}>
                <div className="card-header-row">
                  <h2>{w.name}</h2>
                  <span className={`discipline-badge discipline-${w.discipline.toLowerCase()}`}>
                    {w.discipline === 'BIKE' ? 'Bike' : 'Run'}
                  </span>
                </div>
                <div className="plan-card-stats">
                  <div>
                    <span className="muted">Duration</span>
                    <span>{w.durationMin != null ? formatDuration(w.durationMin) : '—'}</span>
                  </div>
                  <div>
                    <span className="muted">Intensity</span>
                    <DotScale value={w.intensity} />
                  </div>
                  <div>
                    <span className="muted">Training stress</span>
                    <DotScale value={w.trainingStress} />
                  </div>
                </div>
                {w.profile && <p className="plan-card-profile">{w.profile}</p>}
                <button
                  type="button"
                  className={isSelected ? 'secondary' : ''}
                  disabled={selectingPath === w.path}
                  onClick={() => selectWorkout(w)}
                >
                  {isSelected ? 'Selected as today’s workout ✓' : 'Set as today’s workout'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
