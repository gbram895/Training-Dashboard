import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { Workout, WorkoutType } from '../api/types';
import { mondayOf } from '../lib/week';
import PageHead from '../components/PageHead';
import GradientActivityList, { TYPE_ICON, TYPE_LABEL } from '../components/dashboard/GradientActivityList';

const FILTER_ORDER: WorkoutType[] = ['RIDE', 'RUN', 'SWIM', 'STRENGTH', 'WALK', 'BADMINTON', 'OTHER'];

function weekLabel(date: string, thisMonday: number, lastMonday: number): string {
  const d = new Date(date);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (t >= thisMonday) return 'This week';
  if (t >= lastMonday) return 'Last week';
  return 'Earlier';
}

export default function Workouts() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WorkoutType | 'ALL'>('ALL');

  useEffect(() => {
    apiFetch<Workout[]>('/workouts').then((data) => {
      setWorkouts(data);
      setLoading(false);
    });
  }, []);

  const presentTypes = new Set(workouts.map((w) => w.type));
  const filterTypes = FILTER_ORDER.filter((t) => presentTypes.has(t));

  const filtered = filter === 'ALL' ? workouts : workouts.filter((w) => w.type === filter);

  const thisMonday = mondayOf(new Date()).getTime();
  const lastMonday = thisMonday - 7 * 86_400_000;

  const groups: { label: string; workouts: Workout[] }[] = [];
  for (const w of filtered) {
    const label = weekLabel(w.date, thisMonday, lastMonday);
    const current = groups[groups.length - 1];
    if (current?.label === label) current.workouts.push(w);
    else groups.push({ label, workouts: [w] });
  }

  return (
    <div className="page">
      <div className="gd-workouts-top">
        <PageHead title="Workouts" />

        {!loading && filterTypes.length > 1 && (
          <div className="gd-filter-row">
            <button
              type="button"
              className={`gd-filter-chip${filter === 'ALL' ? ' gd-on' : ''}`}
              onClick={() => setFilter('ALL')}
            >
              All
            </button>
            {filterTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`gd-filter-chip${filter === t ? ' gd-on' : ''}`}
                onClick={() => setFilter(t)}
              >
                {TYPE_ICON[t]} {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : workouts.length === 0 ? (
          <p className="muted">No workouts yet. Tap + to log your first session.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">No {TYPE_LABEL[filter as WorkoutType]?.toLowerCase()} workouts yet.</p>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="gd-week-label">{g.label}</div>
              <GradientActivityList workouts={g.workouts} />
            </div>
          ))
        )}
      </div>

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
