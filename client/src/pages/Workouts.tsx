import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { Workout } from '../api/types';
import WorkoutList from '../components/WorkoutList';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  OTHER: 'Other',
};

export default function Workouts() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Workout[]>('/workouts').then((data) => {
      setWorkouts(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Workouts</h1>
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="muted">No workouts yet. Tap + to log your first session.</p>
      ) : (
        <section className="card">
          <WorkoutList workouts={workouts} labels={WORKOUT_LABELS} />
        </section>
      )}

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
