import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type {
  DailyHealthSummary,
  DisciplineStats,
  DropboxSyncStatus,
  FitnessPoint,
  Goal,
  HrZoneWeek,
  SelectedWorkout,
  Workout,
} from '../api/types';
import WorkoutList from '../components/WorkoutList';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import HeaderSyncButtons from '../components/dashboard/HeaderSyncButtons';
import TodaysWorkoutCard from '../components/dashboard/TodaysWorkoutCard';
import DropboxSyncBar from '../components/dashboard/DropboxSyncBar';
import StravaSyncBar from '../components/dashboard/StravaSyncBar';
import SummaryBar from '../components/dashboard/SummaryBar';
import StatTilesRow from '../components/dashboard/StatTilesRow';
import HrvTrendChart from '../components/dashboard/HrvTrendChart';
import HrvWeekCompareChart from '../components/dashboard/HrvWeekCompareChart';
import SleepRhrCharts from '../components/dashboard/SleepRhrCharts';
import HrZonesChart from '../components/dashboard/HrZonesChart';
import DisciplineCharts from '../components/dashboard/DisciplineCharts';
import FitnessChart from '../components/dashboard/FitnessChart';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  BADMINTON: 'Badminton',
  OTHER: 'Other',
};

export default function Dashboard() {
  const [days, setDays] = useState<DailyHealthSummary[] | null>(null);
  const [disciplineStats, setDisciplineStats] = useState<DisciplineStats | null>(null);
  const [hrZones, setHrZones] = useState<HrZoneWeek[] | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [recent, setRecent] = useState<Workout[]>([]);
  const [syncStatus, setSyncStatus] = useState<DropboxSyncStatus | null>(null);
  const [todaysWorkout, setTodaysWorkout] = useState<SelectedWorkout | null>(null);
  const [fitness, setFitness] = useState<FitnessPoint[] | null>(null);

  function load() {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
    apiFetch<DisciplineStats>('/workouts/discipline-stats').then(setDisciplineStats);
    apiFetch<HrZoneWeek[]>('/workouts/hr-zones-weekly').then(setHrZones);
    apiFetch<Goal[]>('/goals').then(setGoals);
    apiFetch<Workout[]>('/workouts?limit=5').then(setRecent);
    apiFetch<DropboxSyncStatus>('/health/dropbox/status').then(setSyncStatus);
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setTodaysWorkout);
    apiFetch<FitnessPoint[]>('/workouts/fitness').then(setFitness);
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
            syncActions={<HeaderSyncButtons status={syncStatus} onSynced={load} />}
          />

          <SummaryBar stats={disciplineStats} />

          <TodaysWorkoutCard workout={todaysWorkout} onCleared={load} />

          <DropboxSyncBar status={syncStatus} />

          <StatTilesRow days={days} disciplineStats={disciplineStats} />

          <HrvTrendChart days={days} />

          <div className="dash-two-col">
            <HrvWeekCompareChart days={days} />
            <SleepRhrCharts days={days} />
          </div>

          <HrZonesChart weeks={hrZones} />

          {fitness !== null && <FitnessChart series={fitness} onBackfilled={load} />}

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

          <StravaSyncBar onSynced={load} />
        </>
      )}

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
