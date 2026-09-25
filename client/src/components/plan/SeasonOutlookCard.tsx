import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { SeasonOutlook, TrainingPhase } from '../../api/types';

const PHASE_LABEL: Record<TrainingPhase, string> = {
  BUILD: 'Build',
  RECOVERY: 'Recovery',
  TAPER: 'Taper',
  EVENT: 'Race week',
  POST_RACE: 'Easy',
};

function formatWeek(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}

/**
 * The season, week by week, from now to the last goal on the list.
 *
 * The plan itself only ever generates a fortnight ahead, so without this the
 * athlete can set a goal ten months out and see nothing that says it has been
 * taken into account. Each bar is what that week asks of them relative to their
 * standing hours, and the line behind it is where fitness is projected to be —
 * both re-derived from real current fitness every time this loads, so it stays
 * a projection rather than a promise made once and never revisited.
 */
export default function SeasonOutlookCard({ reloadKey }: { reloadKey: number }) {
  const [outlook, setOutlook] = useState<SeasonOutlook | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch<SeasonOutlook>('/training-plan/season')
      .then(setOutlook)
      .catch(() => setOutlook(null));
  }, [reloadKey]);

  const weeks = outlook?.weeks ?? [];
  if (weeks.length === 0) return null;

  const peakCtl = Math.max(...weeks.map((w) => w.projectedCtl), 1);
  const startCtl = outlook?.currentCtl ?? weeks[0].projectedCtl;
  const endCtl = weeks[weeks.length - 1].projectedCtl;
  const lastEventWeek = [...weeks].reverse().find((w) => w.events.length > 0);
  const peakWeek = weeks.reduce((best, w) => (w.projectedCtl > best.projectedCtl ? w : best), weeks[0]);

  const shown = expanded ? weeks : weeks.slice(0, 16);

  return (
    <div className="gd-season-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>Season outlook</h4>
      </div>

      <p className="gd-set-note">
        {weeks.length} week{weeks.length === 1 ? '' : 's'} to{' '}
        {lastEventWeek?.events[lastEventWeek.events.length - 1]?.name ?? 'your last goal'}. Fitness is projected to go
        from <strong className="mono">{Math.round(startCtl)}</strong> to{' '}
        <strong className="mono">{Math.round(peakWeek.projectedCtl)}</strong> at its peak
        {Math.round(endCtl) !== Math.round(peakWeek.projectedCtl) && (
          <>
            {' '}
            (<span className="mono">{Math.round(endCtl)}</span> by the end, after the taper)
          </>
        )}
        .
      </p>

      <div className="gd-season-chart">
        {shown.map((week, i) => {
          const prevMonth = i > 0 ? monthLabel(shown[i - 1].weekStart) : null;
          const month = monthLabel(week.weekStart);
          const height = Math.max(4, Math.round((week.loadMultiplier / 1.5) * 100));
          const ctlHeight = Math.round((week.projectedCtl / peakCtl) * 100);
          return (
            <div className="gd-season-week" key={week.weekStart}>
              <div className="gd-season-bar-wrap" title={`Week of ${formatWeek(week.weekStart)}`}>
                <span className="gd-season-ctl" style={{ bottom: `${ctlHeight}%` }} />
                <span
                  className={`gd-season-bar gd-season-${week.phase.toLowerCase().replace('_', '-')}`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="gd-season-month">{month !== prevMonth ? month : ''}</span>
              {/* Always rendered, so a week with a race doesn't end up taller
                  than its neighbours and lift its own bar off the baseline. */}
              <span
                className={
                  week.events.length > 0
                    ? `gd-season-flag gd-priority-${week.events[0].priority.toLowerCase()}`
                    : 'gd-season-flag gd-season-flag-empty'
                }
                title={week.events.map((e) => e.name).join(', ')}
              >
                {week.events[0]?.priority ?? ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="gd-season-legend">
        {(['BUILD', 'RECOVERY', 'TAPER', 'EVENT'] as TrainingPhase[]).map((p) => (
          <span key={p}>
            <i className={`gd-season-swatch gd-season-${p.toLowerCase()}`} /> {PHASE_LABEL[p]}
          </span>
        ))}
      </div>

      {weeks.length > 16 && (
        <button type="button" className="gd-why-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show the next few months' : `Show all ${weeks.length} weeks`}
        </button>
      )}
    </div>
  );
}
