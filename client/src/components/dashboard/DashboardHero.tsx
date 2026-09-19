import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import type { PlannedDay, SelectedWorkout } from '../../api/types';
import { formatDuration } from '../../lib/format';
import ProgressRing from '../ProgressRing';

const DISCIPLINE_EMOJI: Record<string, string> = { BIKE: '🚴', RUN: '🏃' };

export default function DashboardHero({
  workout,
  plannedToday,
  readiness,
  onCleared,
}: {
  workout: SelectedWorkout | null;
  plannedToday: PlannedDay | null;
  readiness: number | null;
  onCleared: () => void;
}) {
  const navigate = useNavigate();

  async function clearSelection(e: React.MouseEvent) {
    e.stopPropagation();
    await apiFetch('/workout-library/selected', { method: 'DELETE' });
    onCleared();
  }

  if (!workout && plannedToday?.isRestDay) {
    return (
      <div className="gd-hero gd-hero-rest">
        <span className="gd-hero-rest-icon">😌</span>
        <h2 style={{ margin: '0 0 4px', fontSize: 19 }}>Rest day</h2>
        <p className="muted" style={{ margin: 0 }}>
          {plannedToday.restReason ?? 'No training scheduled today — recover up.'}
        </p>
      </div>
    );
  }

  const active = workout ?? (plannedToday && !plannedToday.isRestDay ? plannedToday : null);

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
  const emoji = DISCIPLINE_EMOJI[discipline] ?? '🚴';
  const disciplineLabel = discipline === 'RUN' ? 'Running' : 'Cycling';

  return (
    <div className="gd-hero" onClick={() => navigate('/plan/today')} style={{ cursor: 'pointer' }}>
      <div className="gd-hero-top">
        <span className="gd-hero-label">Today's session</span>
        <span className="gd-hero-tag">On plan</span>
      </div>
      <div className="gd-hero-body">
        {ring}
        <div className="gd-hero-info">
          <h2>{active.name ?? 'Workout'}</h2>
          <div className="gd-meta">
            <span>
              {emoji} {disciplineLabel}
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
