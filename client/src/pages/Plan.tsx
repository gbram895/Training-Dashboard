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
import RearrangePlanModal from '../components/RearrangePlanModal';
import WeeklyAvailabilityModal from '../components/WeeklyAvailabilityModal';
import PageHead from '../components/PageHead';
import { useCachedState } from '../lib/pageCache';
import { weekdayLabel } from '../lib/planDates';

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

const CONFIG_HOUR_KEYS = [
  'sundayHours',
  'mondayHours',
  'tuesdayHours',
  'wednesdayHours',
  'thursdayHours',
  'fridayHours',
  'saturdayHours',
] as const;

// The recurring weekly target for today's weekday — the availability slider's
// starting point before any one-off override for today has been set.
function todayConfigHours(config: TrainingPlanConfig | null | undefined): number {
  if (!config) return 0;
  return config[CONFIG_HOUR_KEYS[new Date().getUTCDay()]];
}

function formatHours(h: number): string {
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m`;
  if (min === 0) return `${hours}h`;
  return `${hours}h ${min}m`;
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
  const [workouts, setWorkouts] = useCachedState<LibraryWorkout[] | null>('plan.workouts', null);
  const [selected, setSelected] = useCachedState<SelectedWorkout | null>('plan.selected', null);
  const [error, setError] = useState<string | null>(null);
  const [selectingPath, setSelectingPath] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<PlannedDiscipline>('BIKE');
  const [category, setCategory] = useState<WorkoutCategory | 'OTHER' | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [thresholds, setThresholds] = useCachedState<ThresholdSettings | null>('plan.thresholds', null);

  const [planConfig, setPlanConfig] = useCachedState<TrainingPlanConfig | null | undefined>('plan.config', undefined);
  const [planWeek, setPlanWeek] = useCachedState<PlannedDay[]>('plan.week', []);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [previewDay, setPreviewDay] = useState<PlannedDay | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [showWhy, setShowWhy] = useState(false);
  const [availability, setAvailability] = useState(0);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [showRearrangeModal, setShowRearrangeModal] = useState(false);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);

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
        apiFetch<PlannedDay[]>('/training-plan/week').then((week) => {
          setPlanWeek(week);
          setSelectedDayIndex(0);
        });
      } else {
        setPlanWeek([]);
      }
    });
  }

  useEffect(load, []);

  // Deep link from the Sunday-evening push notification.
  useEffect(() => {
    if (planWeek.length === 0) return;
    if (!new URLSearchParams(window.location.search).has('checkin')) return;
    setShowAvailabilityModal(true);
    navigate('/plan', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planWeek.length]);

  const todayIndex = planWeek.findIndex((d) => weekdayLabel(d.date).isToday);
  const todayPlanned = todayIndex >= 0 ? planWeek[todayIndex] : null;

  useEffect(() => {
    if (todayPlanned) setAvailability(todayPlanned.availableHoursOverride ?? todayConfigHours(planConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanned?.id, todayPlanned?.availableHoursOverride]);

  async function commitAvailability(hours: number) {
    setSavingAvailability(true);
    try {
      const updated = await apiFetch<PlannedDay>('/training-plan/today/availability', {
        method: 'PUT',
        body: JSON.stringify({ hours }),
      });
      setPlanWeek(planWeek.map((d) => (weekdayLabel(d.date).isToday ? updated : d)));
    } finally {
      setSavingAvailability(false);
    }
  }

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

  function selectDayTab(index: number) {
    setSelectedDayIndex(index);
    setShowWhy(false);
  }

  const selectedDay = planWeek[selectedDayIndex] ?? null;

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
      <div className="gd-plan-top">
        <PageHead title="Plan" />

        {planConfig !== undefined &&
          (!planConfig ? (
            <div className="gd-plan-empty-card">
              <div className="plan-week-header">
                <h2>Your plan</h2>
                <button type="button" className="secondary" onClick={() => setShowPlanModal(true)}>
                  New plan
                </button>
              </div>
              <p className="muted">
                Set a weekly training rhythm and the app will pick a workout — or a rest day — for you every day,
                based on your fitness and recovery.
              </p>
            </div>
          ) : planWeek.length === 0 ? (
            <div className="gd-plan-empty-card">
              <p className="muted">Building your plan…</p>
            </div>
          ) : (
            <>
              <div className="gd-date-rail">
                {planWeek.map((day, i) => {
                  const { name, date, isToday } = weekdayLabel(day.date);
                  return (
                    <button
                      type="button"
                      key={day.id}
                      className={`gd-date-card${i === selectedDayIndex ? ' gd-selected' : ''}`}
                      onClick={() => selectDayTab(i)}
                    >
                      {day.manualOverride && (
                        <span className="gd-dc-pin" title="Manually rearranged">
                          📌
                        </span>
                      )}
                      <span className="gd-dc-day">{name}</span>
                      <p className="gd-dc-date">{isToday ? 'Today' : date}</p>
                      <div className="gd-dc-under" />
                    </button>
                  );
                })}
              </div>

              <button type="button" className="gd-why-btn" onClick={() => setShowRearrangeModal(true)}>
                Rearrange days
              </button>
              <button type="button" className="gd-why-btn" onClick={() => setShowAvailabilityModal(true)}>
                Set next week's availability
              </button>

              <div className="gd-availability-card">
                <div className="gd-availability-row">
                  <span className="gd-availability-label">Today's availability</span>
                  <span className="gd-availability-value mono">{formatHours(availability)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.25}
                  value={availability}
                  disabled={!todayPlanned || savingAvailability}
                  onChange={(e) => setAvailability(Number(e.target.value))}
                  onMouseUp={(e) => commitAvailability(Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => commitAvailability(Number((e.target as HTMLInputElement).value))}
                  aria-label="Today's availability in hours"
                />
                {availability > 0 && (
                  <button
                    type="button"
                    className="gd-no-time-btn"
                    disabled={!todayPlanned || savingAvailability}
                    onClick={() => {
                      setAvailability(0);
                      commitAvailability(0);
                    }}
                  >
                    I don't have time today
                  </button>
                )}
              </div>

              <div className="gd-sec-title">
                <span className="gd-flag" />
                <h4>Suggested training</h4>
              </div>
              <div className="gd-sec-under" />

              {selectedDay &&
                (selectedDay.isRestDay ? (
                  <div className="gd-suggest-card">
                    <div className="gd-suggest-rest">
                      <span className="gd-rest-icon">😌</span>
                      <h3>Rest day</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {selectedDay.restReason ?? 'No training scheduled today.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="gd-suggest-card">
                    <div className="gd-suggest-panel">
                      <div className="gd-suggest-top">
                        <div className="gd-suggest-icon">{selectedDay.discipline === 'RUN' ? '🏃' : '🚴'}</div>
                        <button
                          type="button"
                          className="gd-refresh-btn"
                          onClick={() => loadPlan()}
                          aria-label="Refresh plan"
                          title="Refresh"
                        >
                          ⟳
                        </button>
                      </div>

                      {selectedDay.segments && selectedDay.segments.length > 0 && (
                        <WorkoutProfileChart segments={selectedDay.segments} height={70} />
                      )}
                    </div>

                    <div className="gd-suggest-body">
                      <p className="gd-sb-title">{selectedDay.name}</p>

                      <div className="gd-stat-trio">
                        <div>
                          <span className="gd-st-label">Duration</span>
                          <span className="gd-st-val mono">
                            {selectedDay.durationMin != null ? formatDuration(selectedDay.durationMin) : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="gd-st-label">Intensity</span>
                          <span className="gd-st-val mono">{selectedDay.intensity ?? '—'}</span>
                          {selectedDay.intensity != null && (
                            <span className="gd-bars5">
                              <BarScale value={selectedDay.intensity} />
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="gd-st-label">Load</span>
                          <span className="gd-st-val mono">{selectedDay.trainingStress ?? '—'}</span>
                          {selectedDay.trainingStress != null && (
                            <span className="gd-bars5">
                              <BarScale value={selectedDay.trainingStress} />
                            </span>
                          )}
                        </div>
                      </div>

                      <button type="button" className="gd-feedback-cta" onClick={() => openPlanDay(selectedDay)}>
                        View workout
                      </button>
                      <button type="button" className="gd-why-btn" onClick={() => setShowWhy((w) => !w)}>
                        Why this workout?
                      </button>
                    </div>
                    {showWhy && (
                      <p className="gd-plan-why-text">
                        {selectedDay.category
                          ? `Picked as a ${selectedDay.category.toLowerCase()} session based on your current fitness and recovery. `
                          : ''}
                        {selectedDay.profile ?? ''}
                      </p>
                    )}
                  </div>
                ))}

              <p className="gd-plan-note">
                Want a different rhythm? Adjust your weekly hours or discipline mix and Gradient will regenerate your
                plan around it.
              </p>
              <button type="button" className="gd-dashed-fab" onClick={() => setShowPlanModal(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Edit plan
              </button>
            </>
          ))}
      </div>

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

      {showRearrangeModal && (
        <RearrangePlanModal
          week={planWeek}
          onClose={() => setShowRearrangeModal(false)}
          onSwapped={(week) => setPlanWeek(week)}
        />
      )}

      {showAvailabilityModal && (
        <WeeklyAvailabilityModal
          week={planWeek}
          config={planConfig}
          onClose={() => setShowAvailabilityModal(false)}
          onSaved={(week) => {
            setPlanWeek(week);
            setShowAvailabilityModal(false);
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
