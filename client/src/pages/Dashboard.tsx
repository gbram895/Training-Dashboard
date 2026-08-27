import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../api/client';
import type { Workout, WorkoutStats } from '../api/types';
import { useAuth } from '../context/AuthContext';
import WorkoutList from '../components/WorkoutList';
import { formatDuration } from '../lib/format';
import HealthPanel from '../components/HealthPanel';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  OTHER: 'Other',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<WorkoutStats | null>(null);
  const [recent, setRecent] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [statsRes, workoutsRes] = await Promise.all([
        apiFetch<WorkoutStats>('/workouts/stats'),
        apiFetch<Workout[]>('/workouts'),
      ]);
      if (cancelled) return;
      setStats(statsRes);
      setRecent(workoutsRes.slice(0, 5));
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData =
    stats?.weeklyBuckets.map((b) => ({
      week: new Date(b.weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      minutes: b.durationMin,
    })) ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <h1>Hi {user?.name?.split(' ')[0]} 👋</h1>
        <p className="muted">Here's your training over the last 4 weeks</p>
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <HealthPanel />

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-value">{stats?.totalWorkouts ?? 0}</span>
              <span className="stat-label">Workouts</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats ? formatDuration(stats.totalDurationMin) : '0m'}</span>
              <span className="stat-label">Time trained</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats ? stats.totalDistanceKm.toFixed(2) : '0.00'}</span>
              <span className="stat-label">km covered</span>
            </div>
          </div>

          <section className="card">
            <h2>Weekly training minutes</h2>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="week" stroke="var(--text-muted)" fontSize={12} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="minutes" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

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
