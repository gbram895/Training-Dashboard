import type { DisciplineStats } from '../../api/types';

export default function SummaryBar({ stats }: { stats: DisciplineStats }) {
  const total = stats.allTime.RUN.distanceKm + stats.allTime.RIDE.distanceKm + stats.allTime.SWIM.distanceKm;

  return (
    <section className="card summary-bar">
      <span className="summary-label">Training distance</span>
      <span className="summary-total">{total.toFixed(1)} km total</span>
      <span className="summary-item" style={{ color: 'var(--chart-run)' }}>
        {stats.allTime.RUN.distanceKm.toFixed(1)} km Run
      </span>
      <span className="summary-item" style={{ color: 'var(--chart-ride)' }}>
        {stats.allTime.RIDE.distanceKm.toFixed(1)} km Ride
      </span>
      <span className="summary-item" style={{ color: 'var(--chart-swim)' }}>
        {stats.allTime.SWIM.distanceKm.toFixed(1)} km Swim
      </span>
    </section>
  );
}
