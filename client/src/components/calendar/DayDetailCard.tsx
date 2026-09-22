import { Link } from 'react-router-dom';
import type { CalendarDay } from '../../api/types';
import { formatDistance, formatDuration } from '../../lib/format';
import { TYPE_ICON, TYPE_LABEL } from '../dashboard/GradientActivityList';
import { parseDayKey, TYPE_COLOR } from '../../lib/calendarData';
import type { DayStatus } from '../../lib/calendarData';

const STATUS_NOTE: Record<DayStatus, string> = {
  done: 'Trained, as planned',
  extra: 'Trained — the plan had nothing down for this day',
  missed: 'Planned, but nothing came in',
  planned: 'Planned',
  rest: 'Rest day',
  expected: 'Your usual training day — the plan reaches this far nearer the time',
  empty: 'Nothing planned, nothing done',
};

function fullDate(key: string): string {
  return parseDayKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * One day, opened out: what the plan asked for, what was actually trained, and
 * a way through to the workout itself. Shown under the month grid rather than
 * in a modal so the grid stays on screen and tapping day after day feels like
 * reading rather than opening and closing.
 */
export default function DayDetailCard({
  dayKey,
  day,
  status,
  onClose,
}: {
  dayKey: string;
  day: CalendarDay | undefined;
  status: DayStatus;
  onClose: () => void;
}) {
  const planned = day?.planned;
  const done = day?.done ?? [];

  return (
    <div className={`gd-cal-detail gd-cal-detail-${status}`}>
      <div className="gd-cal-detail-head">
        <div>
          <h4>{fullDate(dayKey)}</h4>
          <p className="gd-cal-detail-note">{STATUS_NOTE[status]}</p>
        </div>
        <button type="button" className="gd-cal-close" onClick={onClose} aria-label="Close day">
          ✕
        </button>
      </div>

      {(day?.goals ?? []).map((goal) => (
        <div key={goal.id} className="gd-cal-goal-row">
          <span className={`gd-cal-goal-pill gd-priority-${goal.priority.toLowerCase()}`}>{goal.priority}</span>
          <span>{goal.name}</span>
        </div>
      ))}

      {planned && (
        <div className="gd-cal-block">
          <p className="gd-cal-block-label">Planned</p>
          {planned.isRestDay ? (
            <p className="gd-cal-block-main">Rest{planned.restReason ? ` — ${planned.restReason}` : ''}</p>
          ) : (
            <>
              <p className="gd-cal-block-main">{planned.name ?? 'Session'}</p>
              <p className="gd-cal-block-meta">
                {planned.discipline === 'RUN' ? 'Run' : 'Ride'}
                {planned.durationMin ? ` · ${formatDuration(planned.durationMin)}` : ''}
                {planned.trainingStress ? ` · ${planned.trainingStress} TSS` : ''}
              </p>
              {planned.focus && <p className="gd-cal-block-meta">{planned.focus}</p>}
            </>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="gd-cal-block">
          <p className="gd-cal-block-label">Done</p>
          {done.map((workout) => (
            <Link key={workout.id} to={`/workouts/${workout.id}`} className="gd-cal-done-row">
              <span className="gd-cal-done-icon" style={{ background: `color-mix(in srgb, ${TYPE_COLOR[workout.type]} 20%, transparent)` }}>
                {TYPE_ICON[workout.type]}
              </span>
              <span className="gd-cal-done-info">
                <span className="gd-cal-done-title">{TYPE_LABEL[workout.type]}</span>
                <span className="gd-cal-block-meta">
                  {formatDuration(workout.durationMin)}
                  {workout.distanceKm ? ` · ${formatDistance(workout.distanceKm)}` : ''}
                  {workout.tss ? ` · ${Math.round(workout.tss)} TSS` : ''}
                  {workout.rpe ? ` · RPE ${workout.rpe}` : ''}
                </span>
              </span>
              <span className="gd-cal-chevron">›</span>
            </Link>
          ))}
        </div>
      )}

      {!planned && done.length === 0 && (day?.goals ?? []).length === 0 && (
        <p className="gd-cal-block-meta">Nothing on this day.</p>
      )}
    </div>
  );
}
