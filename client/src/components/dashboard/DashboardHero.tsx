import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import type { PlannedDay, SelectedWorkout, Workout } from '../../api/types';
import { formatDuration } from '../../lib/format';
import ProgressRing from '../ProgressRing';
import Icon from '../Icon';
import { disciplineIcon, TYPE_ICON, TYPE_LABEL } from '../../lib/workoutTypes';

/**
 * The training logged today, latest first. Walks are left out: the watch
 * records the walk to the shops as a workout, and that is not the session.
 */
function trainedToday(workouts: Workout[]): Workout[] {
  const today = new Date().toDateString();
  return workouts
    .filter((w) => w.type !== 'WALK' && new Date(w.date).toDateString() === today)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}


export default function DashboardHero({
  workout,
  plannedToday,
  recentWorkouts,
  readiness,
  onCleared,
}: {
  workout: SelectedWorkout | null;
  plannedToday: PlannedDay | null;
  recentWorkouts: Workout[];
  readiness: number | null;
  onCleared: () => void;
}) {
  const navigate = useNavigate();

  async function clearSelection(e: React.MouseEvent) {
    e.stopPropagation();
    await apiFetch('/workout-library/selected', { method: 'DELETE' });
    onCleared();
  }

  const active = workout ?? (plannedToday && !plannedToday.isRestDay ? plannedToday : null);
  const isRestDay = !workout && !!plannedToday?.isRestDay;

  const ring =
    readiness != null ? (
      <ProgressRing percent={readiness} gradientId="heroRingGrad">
        <span className="gd-num">{readiness}%</span>
        <span className="gd-unit">ready</span>
      </ProgressRing>
    ) : (
      <ProgressRing percent={0} gradientId="heroRingGrad">
        <span className="gd-unit">—</span>
      </ProgressRing>
    );

  // Once something is logged today the card shows what was done rather than
  // what was planned: a different session from the plan's (or a pick made by
  // hand) is still today's training, and "Start workout" no longer applies.
  const done = trainedToday(recentWorkouts);
  if (done.length > 0) {
    const latest = done[0];
    const intended = workout ?? (plannedToday && !plannedToday.isRestDay ? plannedToday : null);
    const title = latest.title?.trim() || TYPE_LABEL[latest.type];
    const footnote = [
      done.length > 1 ? `+${done.length - 1} more today` : null,
      intended?.name && intended.name !== title ? `Planned: ${intended.name}` : null,
    ].filter(Boolean);
    return (
      <div className="gd-hero" onClick={() => navigate(`/workouts/${latest.id}`)} style={{ cursor: 'pointer' }}>
        <div className="gd-hero-top">
          <span className="gd-hero-label">Today's session</span>
          <span className="gd-hero-tag">Done</span>
        </div>
        <div className="gd-hero-body">
          {ring}
          <div className="gd-hero-info">
            <h2>{title}</h2>
            <div className="gd-meta">
              <span>
                <Icon name={TYPE_ICON[latest.type]} /> {TYPE_LABEL[latest.type]}
              </span>
              <span className="gd-dot" />
              <span>
                <b>{formatDuration(latest.durationMin)}</b>
              </span>
              {latest.tss != null && (
                <>
                  <span className="gd-dot" />
                  <span>{Math.round(latest.tss)} TSS</span>
                </>
              )}
            </div>
            {footnote.length > 0 && (
              <div className="gd-meta" style={{ marginTop: 4 }}>
                <span>{footnote.join(' · ')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isRestDay) {
    return (
      <div className="gd-hero">
        <div className="gd-hero-top">
          <span className="gd-hero-label">Today's session</span>
        </div>
        <div className="gd-hero-body">
          {ring}
          <div className="gd-hero-info">
            <h2>Rest day</h2>
            <div className="gd-meta">
              <span>{plannedToday!.restReason ?? 'No training scheduled today — recover up.'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="gd-hero">
        <div className="gd-hero-top">
          <span className="gd-hero-label">Today's session</span>
        </div>
        <div className="gd-hero-body">
          {ring}
          <div className="gd-hero-info">
            <h2>No workout planned</h2>
            <div className="gd-meta">
              <span>
                <Link to="/plan">Pick one from your plan</Link>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const discipline = active.discipline ?? 'BIKE';
  const disciplineLabel = discipline === 'RUN' ? 'Running' : 'Cycling';

  return (
    <div className="gd-hero" onClick={() => navigate('/plan/today')} style={{ cursor: 'pointer' }}>
      <div className="gd-hero-top">
        <span className="gd-hero-label">Today's session</span>
        <span className="gd-hero-tag">{'selectedAt' in active ? 'Your pick' : 'On plan'}</span>
      </div>
      <div className="gd-hero-body">
        {ring}
        <div className="gd-hero-info">
          <h2>{active.name ?? 'Workout'}</h2>
          <div className="gd-meta">
            <span>
              <Icon name={disciplineIcon(discipline)} /> {disciplineLabel}
            </span>
            {active.durationMin != null && (
              <>
                <span className="gd-dot" />
                <span>
                  <b>{formatDuration(active.durationMin)}</b>
                </span>
              </>
            )}
            {active.profile && (
              <>
                <span className="gd-dot" />
                <span>{active.profile}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="gd-hero-cta"
        onClick={(e) => {
          e.stopPropagation();
          navigate('/plan/today');
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
        Start workout
      </button>
      {'selectedAt' in active && (
        <button type="button" className="secondary" style={{ marginTop: 8, width: '100%' }} onClick={clearSelection}>
          Clear
        </button>
      )}
    </div>
  );
}
