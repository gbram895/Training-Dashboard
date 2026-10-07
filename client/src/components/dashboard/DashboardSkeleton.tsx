import Skeleton from '../Skeleton';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The dashboard's shape while the day/stat/zone fetches are still in flight.
 * It reuses the real card classes (gd-hero, gd-stat-tile, gd-week-strip,
 * gd-activity-card) so the skeleton and the loaded screen have identical
 * spacing — when the data lands, nothing jumps.
 */
export default function DashboardSkeleton() {
  return (
    <div className="gd-dashboard-top" aria-busy="true">
      <div className="gd-sk-head">
        <Skeleton w={176} h={22} />
        <Skeleton w={132} h={12} style={{ marginTop: 9 }} />
      </div>

      <div className="gd-hero">
        <Skeleton w={104} h={9} />
        <Skeleton w="62%" h={16} style={{ marginTop: 14 }} />
        <Skeleton w="42%" h={11} style={{ marginTop: 9 }} />
        <div className="gd-hero-cta gd-sk-cta" />
      </div>

      <div className="gd-stat-row">
        {[0, 1, 2].map((i) => (
          <div className="gd-stat-tile" key={i}>
            <Skeleton w={34} h={9} />
            <Skeleton w={54} h={16} style={{ marginTop: 10 }} />
            <Skeleton w={40} h={8} style={{ marginTop: 7 }} />
          </div>
        ))}
      </div>

      <div className="gd-section-head">
        <Skeleton w={84} h={13} />
      </div>
      <div className="gd-week-strip">
        {DAYS.map((day, i) => (
          <div className="gd-sk-day" key={i}>
            <span className="gd-d-label">{day}</span>
            <Skeleton w={30} h={30} r={9} />
          </div>
        ))}
      </div>

      <div className="gd-section-head">
        <Skeleton w={116} h={13} />
      </div>
      {[0, 1, 2].map((i) => (
        <div className="gd-activity-card" key={i}>
          <Skeleton w={40} h={40} r={11} />
          <div className="gd-activity-info">
            <Skeleton w="54%" h={12} />
            <Skeleton w="36%" h={10} style={{ marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
