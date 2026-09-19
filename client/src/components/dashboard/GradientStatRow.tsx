import type { DailyHealthSummary, FitnessPoint } from '../../api/types';
import { average, classifyHrv } from '../../lib/hrv';
import { formatDuration } from '../../lib/format';

export default function GradientStatRow({ days, fitness }: { days: DailyHealthSummary[]; fitness: FitnessPoint[] | null }) {
  const lastNight = days.length ? days[days.length - 1].sleepHours ?? null : null;
  const sleepPct = lastNight != null ? Math.max(4, Math.min(100, (lastNight / 8) * 100)) : 0;
  const sleepNote = lastNight == null ? 'No sleep data' : lastNight >= 7 ? 'Good recovery' : 'Below target';

  const hrvValues = days.map((d) => d.avgHrv ?? null);
  const todayHrv = hrvValues.length ? hrvValues[hrvValues.length - 1] : null;
  const baseline = average(hrvValues.slice(-8, -1));
  const hrvStatus = todayHrv != null && baseline != null ? classifyHrv(todayHrv, baseline) : null;
  const hrvPct = todayHrv != null && baseline != null ? Math.max(4, Math.min(100, (todayHrv / baseline) * 60)) : 0;
  const hrvDelta = todayHrv != null && baseline != null ? todayHrv - baseline : null;

  const tsb = fitness && fitness.length ? fitness[fitness.length - 1].tsb : null;
  const fatiguePct = tsb != null ? Math.max(4, Math.min(100, 50 - tsb * 2.5)) : 0;
  const fatigueLabel = tsb == null ? '—' : tsb > 5 ? 'Low' : tsb > -10 ? 'Moderate' : 'High';

  return (
    <div className="gd-stat-row">
      <div className="gd-stat-tile">
        <span className="gd-stat-label">Sleep</span>
        <div className="gd-stat-value mono">{lastNight != null ? formatDuration(lastNight * 60) : '—'}</div>
        <div className="gd-mini-bar">
          <span style={{ width: `${sleepPct}%`, background: 'var(--good)' }} />
        </div>
        <div className="gd-stat-sub">{sleepNote}</div>
      </div>

      <div className="gd-stat-tile">
        <span className="gd-stat-label">HRV</span>
        <div className="gd-stat-value mono">{todayHrv != null ? `${todayHrv.toFixed(0)}ms` : '—'}</div>
        <div className="gd-mini-bar">
          <span style={{ width: `${hrvPct}%`, background: 'var(--accent-solid)' }} />
        </div>
        <div className="gd-stat-sub">
          {hrvDelta != null
            ? `${hrvDelta >= 0 ? '+' : ''}${hrvDelta.toFixed(0)} vs 7d avg`
            : hrvStatus
              ? hrvStatus
              : 'No HRV data'}
        </div>
      </div>

      <div className="gd-stat-tile">
        <span className="gd-stat-label">Fatigue</span>
        <div className="gd-stat-value mono">{fatigueLabel}</div>
        <div className="gd-mini-bar">
          <span style={{ width: `${fatiguePct}%`, background: 'var(--warn)' }} />
        </div>
        <div className="gd-stat-sub">{tsb != null ? `TSB ${tsb >= 0 ? '+' : ''}${tsb.toFixed(0)}` : 'No fitness data'}</div>
      </div>
    </div>
  );
}
