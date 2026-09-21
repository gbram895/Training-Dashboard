import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type {
  DailyHealthSummary,
  DisciplineStats,
  DropboxSyncStatus,
  FitnessPoint,
  GarminSyncStatus,
  Goal,
  HrZoneWeek,
  PlannedDay,
  SelectedWorkout,
  StravaSyncStatus,
  Workout,
} from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useCachedState } from '../lib/pageCache';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { computeReadiness } from '../lib/readiness';
import { average } from '../lib/hrv';
import { formatDateUTC } from '../lib/format';
import PageHead from '../components/PageHead';
import DashboardHero from '../components/dashboard/DashboardHero';
import GradientStatRow from '../components/dashboard/GradientStatRow';
import WeekStrip from '../components/dashboard/WeekStrip';
import GradientActivityList from '../components/dashboard/GradientActivityList';
import SyncHealthBanner from '../components/dashboard/SyncHealthBanner';

// Everything below the "More" divider (the pre-Gradient recharts analytics)
// in its own chunk — see LegacyAnalytics.tsx for why.
const LegacyAnalytics = lazy(() => import('../components/dashboard/LegacyAnalytics'));

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const [days, setDays] = useCachedState<DailyHealthSummary[] | null>('dash.days', null);
  const [disciplineStats, setDisciplineStats] = useCachedState<DisciplineStats | null>('dash.disciplineStats', null);
  const [hrZones, setHrZones] = useCachedState<HrZoneWeek[] | null>('dash.hrZones', null);
  const [goals, setGoals] = useCachedState<Goal[]>('dash.goals', []);
  const [recent, setRecent] = useCachedState<Workout[]>('dash.recent', []);
  const [syncStatus, setSyncStatus] = useCachedState<DropboxSyncStatus | null>('dash.syncStatus', null);
  const [stravaStatus, setStravaStatus] = useCachedState<StravaSyncStatus | null>('dash.stravaStatus', null);
  const [garminStatus, setGarminStatus] = useCachedState<GarminSyncStatus | null>('dash.garminStatus', null);
  const [syncUnavailable, setSyncUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [todaysWorkout, setTodaysWorkout] = useCachedState<SelectedWorkout | null>('dash.todaysWorkout', null);
  const [plannedToday, setPlannedToday] = useCachedState<PlannedDay | null>('dash.plannedToday', null);
  const [planWeek, setPlanWeek] = useCachedState<PlannedDay[]>('dash.planWeek', []);
  const [fitness, setFitness] = useCachedState<FitnessPoint[] | null>('dash.fitness', null);

  // Stable identity (empty deps) — several memoized chart components take this
  // as a prop, and a new function reference on every render would defeat the
  // memo, re-running their (expensive, recharts-based) render on every
  // unrelated state update.
  const load = useCallback(() => {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
    apiFetch<DisciplineStats>('/workouts/discipline-stats').then(setDisciplineStats);
    apiFetch<HrZoneWeek[]>('/workouts/hr-zones-weekly').then(setHrZones);
    apiFetch<Goal[]>('/goals').then(setGoals);
    apiFetch<Workout[]>('/workouts?limit=10').then(setRecent);
    // A status request that fails leaves the sync UI with nothing to show, so
    // it is tracked rather than swallowed — "cannot tell" is itself worth saying.
    setSyncUnavailable(false);
    apiFetch<DropboxSyncStatus>('/health/dropbox/status')
      .then(setSyncStatus)
      .catch(() => setSyncUnavailable(true));
    apiFetch<StravaSyncStatus>('/health/strava/status')
      .then(setStravaStatus)
      .catch(() => setSyncUnavailable(true));
    apiFetch<GarminSyncStatus>('/health/garmin/status')
      .then(setGarminStatus)
      .catch(() => setSyncUnavailable(true));
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setTodaysWorkout);
    apiFetch<PlannedDay | null>('/training-plan/today').then(setPlannedToday);
    apiFetch<PlannedDay[]>('/training-plan/week').then(setPlanWeek);
    apiFetch<FitnessPoint[]>('/workouts/fitness').then(setFitness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRefreshOnResume(load);

  const retrySyncs = useCallback(
    async (keys: string[]) => {
      setRetrying(true);
      try {
        // Sequential: these hit third-party APIs that rate-limit, and firing
        // every failing source at once is what gets this server blocked.
        for (const key of keys) {
          await apiFetch(`/health/${key}/sync-now`, { method: 'POST' }).catch(() => undefined);
        }
      } finally {
        setRetrying(false);
        load();
      }
    },
    [load],
  );

  const loading = days === null || disciplineStats === null || hrZones === null;

  const hrvValues = days?.map((d) => d.avgHrv ?? null) ?? [];
  const readiness = days
    ? computeReadiness({
        todayHrv: hrvValues.length ? hrvValues[hrvValues.length - 1] : null,
        hrvBaseline: average(hrvValues.slice(-8, -1)),
        sleepHours: days.length ? (days[days.length - 1].sleepHours ?? null) : null,
        tsb: fitness && fitness.length ? fitness[fitness.length - 1].tsb : null,
      })
    : null;

  return (
    <div className="page">
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="gd-dashboard-top">
            <PageHead
              title={timeOfDayGreeting()}
              greeting={formatDateUTC(new Date(), { weekday: 'long', month: 'short', day: 'numeric' })}
              name={user?.name}
            />

            <SyncHealthBanner
              sources={[
                { key: 'dropbox', name: 'Apple Health', status: syncStatus },
                { key: 'strava', name: 'Strava', status: stravaStatus },
                { key: 'garmin', name: 'Garmin', status: garminStatus },
              ]}
              unavailable={syncUnavailable}
              retrying={retrying}
              onRetry={retrySyncs}
            />

            <DashboardHero workout={todaysWorkout} plannedToday={plannedToday} readiness={readiness} onCleared={load} />

            <GradientStatRow days={days} fitness={fitness} />

            <div className="gd-section-head">
              <h3>This week</h3>
              <Link to="/plan" className="gd-link">
                Plan
              </Link>
            </div>
            <WeekStrip planWeek={planWeek} recentWorkouts={recent} />

            <div className="gd-section-head">
              <h3>Recent activity</h3>
              <Link to="/workouts" className="gd-link">
                See all
              </Link>
            </div>
            <GradientActivityList workouts={recent.slice(0, 3)} />
          </div>

          <div className="gd-legacy-divider">More</div>

          <Suspense fallback={<p className="muted">Loading…</p>}>
            <LegacyAnalytics
              days={days}
              disciplineStats={disciplineStats}
              hrZones={hrZones}
              goals={goals}
              recent={recent}
              syncStatus={syncStatus}
              stravaStatus={stravaStatus}
              garminStatus={garminStatus}
              fitness={fitness}
              onSynced={load}
            />
          </Suspense>
        </>
      )}

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
