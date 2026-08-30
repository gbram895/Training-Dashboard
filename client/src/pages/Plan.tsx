import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import type {
  LibraryWorkout,
  PlannedDay,
  PlannedDiscipline,
  SelectedWorkout,
  ThresholdSettings,
  TrainingPlanConfig,
  WorkoutCategory,
} from '../api/types';
import { formatDuration } from '../lib/format';
import BarScale from '../components/BarScale';
import WorkoutDetailView from '../components/WorkoutDetailView';
import WorkoutProfileChart from '../components/WorkoutProfileChart';
import NewPlanModal from '../components/NewPlanModal';

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekdayLabel(dateStr: string): { name: string; date: string; isToday: boolean } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return {
    name: d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }),
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    isToday: dateStr === todayKey(),
  };
}

function plannedDayToLibraryWorkout(day: PlannedDay): LibraryWorkout {
  return {
    path: day.sourcePath ?? '',
    name: day.name ?? 'Workout',
    discipline: (day.discipline ?? 'BIKE') as PlannedDiscipline,
    durationMin: day.durationMin ?? undefined,
    intensity: day.intensity ?? undefined,
    trainingStress: day.trainingStress ?? undefined,
    profile: day.profile ?? undefined,
    segments: day.segments ?? undefined,
    category: day.category ?? undefined,
  };
}

export default function Plan() {
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<LibraryWorkout[] | null>(null);
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingPath, setSelectingPath] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<PlannedDiscipline>('BIKE');
  const [category, setCategory] = useState<WorkoutCategory | 'OTHER' | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<ThresholdSettings | null>(null);

  const [planConfig, setPlanConfig] = useState<TrainingPlanConfig | null | undefined>(undefined);
  const [planWeek, setPlanWeek] = useState<PlannedDay[]>([]);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [previewDay, setPreviewDay] = useState<PlannedDay | null>(null);

  function load() {
    apiFetch<LibraryWorkout[]>('/workout-library')
      .then((data) => {
        setWorkouts(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load workout library'));
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setSelected);
    apiFetch<ThresholdSettings>('/settings/thresholds').then(setThresholds);
    loadPlan();
  }

  function loadPlan() {
    apiFetch<TrainingPlanConfig | null>('/training-plan/config').then((config) => {
      setPlanConfig(config);
      if (config) {
        apiFetch<PlannedDay[]>('/training-plan/week').then(setPlanWeek);
      } else {
        setPlanWeek([]);
      }
    });
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

  function openPlanDay(day: PlannedDay) {
    if (day.isRestDay) return;
    const { isToday } = weekdayLabel(day.date);
    if (isToday) {
      navigate('/plan/today');
    } else {
      setPreviewDay(day);
    }
  }

  const byDiscipline = workouts?.filter((w) => w.discipline === discipline) ?? null;
  const inCategory = category ? (byDiscipline ?? []).filter((w) => (w.category ?? 'OTHER') === category) : [];
  const detailWorkout = detailPath ? (workouts ?? []).find((w) => w.path === detailPath) ?? null : null;

  if (previewDay) {
    return (
      <div className="page">
        <WorkoutDetailView
          workout={plannedDayToLibraryWorkout(previewDay)}
          thresholds={thresholds}
          isSelected={false}
          selecting={false}
          onBack={() => setPreviewDay(null)}
          onSelect={() => {}}
          hideSelectButton
        />
      </div>
    );
  }

  if (detailWorkout) {
    return (
      <div className="page">
        <WorkoutDetailView
          workout={detailWorkout}
          thresholds={thresholds}
          isSelected={selected?.sourcePath === detailWorkout.path}
          selecting={selectingPath === detailWorkout.path}
          onBack={() => setDetailPath(null)}
          onSelect={() => selectWorkout(detailWorkout)}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Plan</h1>
      </header>

      {planConfig !== undefined && (
        <section className="card">
          <div className="plan-week-header">
            <h2>Your plan</h2>
            <button type="button" className="secondary" onClick={() => setShowPlanModal(true)}>
              {planConfig ? 'Edit plan' : 'New plan'}
            </button>
          </div>

          {!planConfig ? (
            <p className="muted">
              Set a weekly training rhythm and the app will pick a workout — or a rest day — for you every day, based
              on your fitness and recovery.
            </p>
          ) : planWeek.length === 0 ? (
            <p className="muted">Building your plan…</p>
          ) : (
            <div className="plan-week-grid">
              {planWeek.map((day) => {
                const { name, date, isToday } = weekdayLabel(day.date);
                return (
                  <div
                    key={day.id}
                    className={`plan-week-day${isToday ? ' plan-week-day-today' : ''}`}
                    onClick={() => openPlanDay(day)}
                    style={{ cursor: day.isRestDay ? 'default' : 'pointer' }}
                  >
                    <div className="plan-week-day-label">
                      <span className="plan-week-day-name">
                        {isToday ? 'Today' : name}
                      </span>
                      <span className="plan-week-day-date">{date}</span>
                    </div>
                    <div className="plan-week-day-body">
                      {day.isRestDay ? (
                        <span className="plan-week-day-rest">{day.restReason ?? 'Rest day'}</span>
                      ) : (
                        <>
                          <span className="plan-week-day-title">{day.name}</span>
                          <span className="plan-week-day-meta">
                            {day.durationMin != null ? formatDuration(day.durationMin) : ''}
                            {day.category ? ` · ${day.category}` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showPlanModal && (
        <NewPlanModal
          initialConfig={planConfig ?? null}
          onClose={() => setShowPlanModal(false)}
          onSaved={() => {
            setShowPlanModal(false);
            loadPlan();
          }}
        />
      )}

      <h2 className="plan-category-heading">Workout library</h2>

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
                      <div
                        className={`card plan-card plan-card-clickable${isSelected ? ' plan-card-selected' : ''}`}
                        key={w.path}
                        onClick={() => setDetailPath(w.path)}
                      >
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
                          onClick={(e) => {
                            e.stopPropagation();
                            selectWorkout(w);
                          }}
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
