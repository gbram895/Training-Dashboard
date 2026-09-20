import { Link } from 'react-router-dom';
import type { DailyHealthSummary, DisciplineStats, DropboxSyncStatus, FitnessPoint, Goal, HrZoneWeek, Workout } from '../../api/types';
import WorkoutList from '../WorkoutList';
import DashboardHeader from './DashboardHeader';
import HeaderSyncButtons from './HeaderSyncButtons';
import DropboxSyncBar from './DropboxSyncBar';
import StravaSyncBar from './StravaSyncBar';
import GarminSyncBar from './GarminSyncBar';
import SummaryBar from './SummaryBar';
import StatTilesRow from './StatTilesRow';
import HrvTrendChart from './HrvTrendChart';
import HrvWeekCompareChart from './HrvWeekCompareChart';
import SleepRhrCharts from './SleepRhrCharts';
import HrZonesChart from './HrZonesChart';
import DisciplineCharts from './DisciplineCharts';
import FitnessChart from './FitnessChart';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  BADMINTON: 'Badminton',
  OTHER: 'Other',
};

// Everything below Dashboard's "More" divider: the pre-Gradient analytics
// charts (all recharts-based) plus the sync bars. Loaded as its own chunk
// (see Dashboard.tsx's React.lazy import) so recharts and its six chart
// wrappers aren't part of the JS everyone downloads just to see the hero and
// today's stats — this is the single biggest contributor to the bundle-size
// build warning.
export default function LegacyAnalytics({
  days,
  disciplineStats,
  hrZones,
  goals,
  recent,
  syncStatus,
  fitness,
  onSynced,
}: {
  days: DailyHealthSummary[];
  disciplineStats: DisciplineStats;
  hrZones: HrZoneWeek[];
  goals: Goal[];
  recent: Workout[];
  syncStatus: DropboxSyncStatus | null;
  fitness: FitnessPoint[] | null;
  onSynced: () => void;
}) {
  return (
    <>
      <DashboardHeader
        latestDataDate={days.length ? days[days.length - 1].date : null}
        lastSyncedAt={syncStatus?.lastSyncedAt ?? null}
        goals={goals}
        syncActions={<HeaderSyncButtons status={syncStatus} onSynced={onSynced} />}
      />

      <SummaryBar stats={disciplineStats} />

      <DropboxSyncBar status={syncStatus} />

      <StatTilesRow days={days} disciplineStats={disciplineStats} />

      <HrvTrendChart days={days} />

      <div className="dash-two-col">
        <HrvWeekCompareChart days={days} />
        <SleepRhrCharts days={days} />
      </div>

      <HrZonesChart weeks={hrZones} />

      {fitness !== null && <FitnessChart series={fitness} onBackfilled={onSynced} />}

      <DisciplineCharts weekly={disciplineStats.weekly} />

      <section className="card">
        <div className="card-header-row">
          <h2>Recent workouts</h2>
          <Link to="/workouts" className="link">
            See all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No workouts logged yet. Add your first one!</p>
        ) : (
          <WorkoutList workouts={recent} labels={WORKOUT_LABELS} />
        )}
      </section>

      <StravaSyncBar onSynced={onSynced} />

      <GarminSyncBar onSynced={onSynced} />
    </>
  );
}
