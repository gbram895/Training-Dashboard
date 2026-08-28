import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { LibraryWorkout, PlannedDiscipline, SelectedWorkout, WorkoutCategory } from '../api/types';
import { formatDuration } from '../lib/format';
import BarScale from '../components/BarScale';
import WorkoutProfileChart from '../components/WorkoutProfileChart';

const CATEGORY_INFO: { key: WorkoutCategory | 'OTHER'; label: string; icon: string; description: string }[] = [
  { key: 'VO2MAX', label: 'VO2Max', icon: '💨', description: 'Short, maximal efforts that push your aerobic ceiling.' },
  {
    key: 'THRESHOLD',
    label: 'Threshold',
    icon: '🔄',
    description: 'Sustained efforts right at your functional threshold.',
  },
  { key: 'TEMPO', label: 'Tempo', icon: '🔥', description: 'Comfortably hard efforts that build aerobic strength.' },
  {
    key: 'ENDURANCE',
    label: 'Endurance',
    icon: '❤️',
    description: 'Steady, easy-paced training that builds your aerobic base.',
  },
  { key: 'OTHER', label: 'Other', icon: '📋', description: "Workouts without enough data to classify." },
];

export default function Plan() {
  const [workouts, setWorkouts] = useState<LibraryWorkout[] | null>(null);
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingPath, setSelectingPath] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<PlannedDiscipline>('BIKE');
  const [category, setCategory] = useState<WorkoutCategory | 'OTHER' | null>(null);

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

  const byDiscipline = workouts?.filter((w) => w.discipline === discipline) ?? null;
  const inCategory = category ? (byDiscipline ?? []).filter((w) => (w.category ?? 'OTHER') === category) : [];

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
        <>
          <div className="plan-discipline-tabs">
            {(['BIKE', 'RUN'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`plan-discipline-tab${discipline === d ? ' plan-discipline-tab-active' : ''}`}
                onClick={() => {
                  setDiscipline(d);
                  setCategory(null);
                }}
              >
                {d === 'BIKE' ? 'Bike' : 'Run'}
              </button>
            ))}
          </div>

          {category === null ? (
            <div className="plan-category-menu">
              {CATEGORY_INFO.map(({ key, label, icon, description }) => {
                const count = (byDiscipline ?? []).filter((w) => (w.category ?? 'OTHER') === key).length;
                if (count === 0 && key === 'OTHER') return null;
                return (
                  <button
                    key={key}
                    type="button"
                    className="card plan-category-card"
                    onClick={() => setCategory(key)}
                  >
                    <span className="plan-category-card-icon">{icon}</span>
                    <span className="plan-category-card-body">
                      <span className="plan-category-card-title">
                        {label}
                        {count > 0 && <span className="plan-category-card-count"> ({count})</span>}
                      </span>
                      <span className="plan-category-card-description">{description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <button type="button" className="secondary plan-back-button" onClick={() => setCategory(null)}>
                ← Back
              </button>
              <h2 className="plan-category-heading">{CATEGORY_INFO.find((c) => c.key === category)?.label}</h2>

              {inCategory.length === 0 ? (
                <p className="muted">No workouts in this category yet.</p>
              ) : (
                <div className="plan-grid">
                  {inCategory.map((w) => {
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
                        {w.segments && w.segments.length > 0 && (
                          <WorkoutProfileChart segments={w.segments} height={70} />
                        )}
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
            </>
          )}
        </>
      )}
    </div>
  );
}
