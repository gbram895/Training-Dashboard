import type { DisciplineStats } from '../../api/types';

export default function SummaryBar({ stats }: { stats: DisciplineStats }) {
  const total = stats.yearly.RUN.distanceKm + stats.yearly.RIDE.distanceKm + stats.yearly.SWIM.distanceKm;
  const year = new Date().getFullYear();

  return (
    <section className="card summary-bar">
      <span className="summary-label">Training distance ({year})</span>
      <span className="summary-total">{total.toFixed(1)} km total</span>
      <span className="summary-item" style={{ color: 'var(--chart-run)' }}>
        {stats.yearly.RUN.distanceKm.toFixed(1)} km Run
      </span>
      <span className="summary-item" style={{ color: 'var(--chart-ride)' }}>
        {stats.yearly.RIDE.distanceKm.toFixed(1)} km Ride
      </span>
      <span className="summary-item" style={{ color: 'var(--chart-swim)' }}>
        {stats.yearly.SWIM.distanceKm.toFixed(1)} km Swim
      </span>
      <span className="summary-item" style={{ color: 'var(--chart-badminton)' }}>
        {stats.badmintonHours.toFixed(1)}h Badminton
      </span>
    </section>
  );
}
