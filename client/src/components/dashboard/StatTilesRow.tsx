import type { DailyHealthSummary, DisciplineStats } from '../../api/types';
import { average, classifyHrv, HRV_STATUS_COLOR } from '../../lib/hrv';
import { formatDuration } from '../../lib/format';
import { weekKey } from '../../lib/week';

function latestValue(days: DailyHealthSummary[], key: keyof DailyHealthSummary): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i][key];
    if (typeof value === 'number') return value;
  }
  return null;
}

export default function StatTilesRow({
  days,
  disciplineStats,
}: {
  days: DailyHealthSummary[];
  disciplineStats: DisciplineStats;
}) {
  const hrvValues = days.map((d) => d.avgHrv ?? null);
  const todayHrv = latestValue(days, 'avgHrv');
  const last7 = average(hrvValues.slice(-7));
  const prev7 = average(hrvValues.slice(-14, -7));
  const hrvDelta = last7 != null && prev7 != null ? last7 - prev7 : null;
  const status = todayHrv != null && last7 != null ? classifyHrv(todayHrv, last7) : null;

  const thisWeekKey = weekKey(new Date());
  const thisWeek = disciplineStats.weekly.find((w) => w.weekStart === thisWeekKey);
  const weekDistance = thisWeek ? thisWeek.RUN.distanceKm + thisWeek.RIDE.distanceKm + thisWeek.SWIM.distanceKm : 0;
  const weekDuration = thisWeek ? thisWeek.RUN.durationMin + thisWeek.RIDE.durationMin + thisWeek.SWIM.durationMin : 0;

  const avgSleep = average(days.slice(-7).map((d) => d.sleepHours));
  const avgRestingHr = average(days.slice(-7).map((d) => d.restingHeartRate));

  return (
    <div className="stat-tiles-row">
      <div className="stat-tile">
        <span className="stat-tile-label">Today's HRV</span>
        <span className="stat-tile-value" style={status ? { color: HRV_STATUS_COLOR[status] } : undefined}>
          {todayHrv != null ? `${todayHrv.toFixed(0)} ms` : '—'}
        </span>
        {status && <span className="stat-tile-sub">{status}</span>}
      </div>

      <div className="stat-tile">
        <span className="stat-tile-label">7-day avg HRV</span>
        <span className="stat-tile-value" style={{ color: 'var(--chart-sleep)' }}>
          {last7 != null ? `${last7.toFixed(0)} ms` : '—'}
        </span>
        {hrvDelta != null && (
          <span className="stat-tile-sub" style={{ color: hrvDelta >= 0 ? 'var(--chart-swim)' : 'var(--chart-heart-rate)' }}>
            {hrvDelta >= 0 ? '+' : ''}
            {hrvDelta.toFixed(0)} ms vs last week
          </span>
        )}
      </div>

      <div className="stat-tile">
        <span className="stat-tile-label">Week distance</span>
        <span className="stat-tile-value">{weekDistance.toFixed(1)} km</span>
        {thisWeek && (
          <span className="stat-tile-sub">
            Ride {thisWeek.RIDE.distanceKm.toFixed(1)} · Swim {thisWeek.SWIM.distanceKm.toFixed(1)} · Run{' '}
            {thisWeek.RUN.distanceKm.toFixed(1)}
          </span>
        )}
      </div>

      <div className="stat-tile">
        <span className="stat-tile-label">Week time</span>
        <span className="stat-tile-value">{formatDuration(weekDuration)}</span>
        {thisWeek && (
          <span className="stat-tile-sub">
            Ride {formatDuration(thisWeek.RIDE.durationMin)} · Swim {formatDuration(thisWeek.SWIM.durationMin)} · Run{' '}
            {formatDuration(thisWeek.RUN.durationMin)}
          </span>
        )}
      </div>

      <div className="stat-tile">
        <span className="stat-tile-label">Avg sleep / RHR</span>
        <span className="stat-tile-value">{avgSleep != null ? formatDuration(avgSleep * 60) : '—'}</span>
        {avgRestingHr != null && <span className="stat-tile-sub">{avgRestingHr.toFixed(0)} bpm resting</span>}
      </div>
    </div>
  );
}
