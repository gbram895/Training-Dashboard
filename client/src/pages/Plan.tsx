import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { LibraryWorkout, SelectedWorkout, WorkoutCategory } from '../api/types';
import { formatDuration } from '../lib/format';
import BarScale from '../components/BarScale';
import WorkoutProfileChart from '../components/WorkoutProfileChart';

const CATEGORY_SECTIONS: { key: WorkoutCategory | 'OTHER'; label: string }[] = [
  { key: 'VO2MAX', label: 'VO2Max' },
  { key: 'THRESHOLD', label: 'Threshold' },
  { key: 'TEMPO', label: 'Tempo' },
  { key: 'ENDURANCE', label: 'Endurance' },
  { key: 'OTHER', label: 'Other' },
];

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
          No workouts found. Add files to a "Workout Database" folder in your Dropbox — one workout per file.
          <br />
          <br />
          <strong>.fit</strong> and <strong>.zwo</strong> files are parsed automatically: name, duration, and
          bike/run come straight from the file, and intensity/training stress are estimated from its power or pace
          targets against your FTP and threshold pace (set those in Settings).
          <br />
          <br />
          Plain text files also work, e.g.:
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
        CATEGORY_SECTIONS.map(({ key, label }) => {
          const inSection = workouts.filter((w) => (w.category ?? 'OTHER') === key);
          if (inSection.length === 0) return null;
          return (
            <section key={key} className="plan-category">
              <h2 className="plan-category-heading">{label}</h2>
              <div className="plan-grid">
                {inSection.map((w) => {
                  const isSelected = selected?.sourcePath === w.path;
                  return (
                    <div className={`card plan-card${isSelected ? ' plan-card-selected' : ''}`} key={w.path}>
                      <div className="workout-card-header">
                        <h2 className="workout-card-title">{w.name}</h2>
                        <span className={`discipline-pill discipline-${w.discipline.toLowerCase()}`}>
                          {w.discipline === 'BIKE' ? '🚴 Bike' : '🏃 Run'}
                        </span>
                      </div>
                      <div className="workout-stat-tiles">
                        <div className="workout-stat">
                          <span className="workout-stat-value">
                            {w.durationMin != null ? formatDuration(w.durationMin) : '—'}
                          </span>
                          <span className="workout-stat-label">Duration</span>
                        </div>
                        <div className="workout-stat">
                          {w.trainingStress != null ? (
                            <BarScale value={w.trainingStress} />
                          ) : (
                            <span className="workout-stat-value">—</span>
                          )}
                          <span className="workout-stat-label">Training stress</span>
                        </div>
                        <div className="workout-stat">
                          {w.intensity != null ? (
                            <BarScale value={w.intensity} />
                          ) : (
                            <span className="workout-stat-value">—</span>
                          )}
                          <span className="workout-stat-label">Intensity</span>
                        </div>
                      </div>
                      {w.segments && w.segments.length > 0 && <WorkoutProfileChart segments={w.segments} height={70} />}
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
            </section>
          );
        })
      )}
    </div>
  );
}
