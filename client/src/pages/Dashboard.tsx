import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { DailyHealthSummary, DisciplineStats, DropboxSyncStatus, Goal, HrZoneWeek, Workout } from '../api/types';
import WorkoutList from '../components/WorkoutList';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DropboxSyncBar from '../components/dashboard/DropboxSyncBar';
import SummaryBar from '../components/dashboard/SummaryBar';
import StatTilesRow from '../components/dashboard/StatTilesRow';
import HrvTrendChart from '../components/dashboard/HrvTrendChart';
import HrvWeekCompareChart from '../components/dashboard/HrvWeekCompareChart';
import SleepRhrCharts from '../components/dashboard/SleepRhrCharts';
import HrZonesChart from '../components/dashboard/HrZonesChart';
import DisciplineCharts from '../components/dashboard/DisciplineCharts';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  OTHER: 'Other',
};

export default function Dashboard() {
  const [days, setDays] = useState<DailyHealthSummary[] | null>(null);
  const [disciplineStats, setDisciplineStats] = useState<DisciplineStats | null>(null);
  const [hrZones, setHrZones] = useState<HrZoneWeek[] | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [recent, setRecent] = useState<Workout[]>([]);
  const [syncStatus, setSyncStatus] = useState<DropboxSyncStatus | null>(null);

  function load() {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
    apiFetch<DisciplineStats>('/workouts/discipline-stats').then(setDisciplineStats);
    apiFetch<HrZoneWeek[]>('/workouts/hr-zones-weekly').then(setHrZones);
    apiFetch<Goal[]>('/goals').then(setGoals);
    apiFetch<Workout[]>('/workouts').then((w) => setRecent(w.slice(0, 5)));
    apiFetch<DropboxSyncStatus>('/health/dropbox/status').then(setSyncStatus);
  }

  useEffect(load, []);

  const loading = days === null || disciplineStats === null || hrZones === null;

  return (
    <div className="page">
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <DashboardHeader
            latestDataDate={days.length ? days[days.length - 1].date : null}
            lastSyncedAt={syncStatus?.lastSyncedAt ?? null}
            goals={goals}
          />

          <DropboxSyncBar onSynced={load} />

          <SummaryBar stats={disciplineStats} />

          <StatTilesRow days={days} disciplineStats={disciplineStats} />

          <HrvTrendChart days={days} />

          <div className="dash-two-col">
            <HrvWeekCompareChart days={days} />
            <SleepRhrCharts days={days} />
          </div>

          <HrZonesChart weeks={hrZones} />

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
        </>
      )}

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
