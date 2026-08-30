import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { Workout, WorkoutSample } from '../api/types';
import { formatDateUTC, formatDistance, formatDuration, formatPace, formatSpeed } from '../lib/format';
import WorkoutSampleChart from '../components/WorkoutSampleChart';

const WORKOUT_LABELS: Record<string, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  STRENGTH: 'Strength',
  SWIM: 'Swim',
  WALK: 'Walk',
  BADMINTON: 'Badminton',
  OTHER: 'Other',
};

const MAX_CHART_POINTS = 400;

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  const step = Math.ceil(items.length / maxPoints);
  return items.filter((_, i) => i % step === 0);
}

function paceMinutesToLabel(minPerKm: number): string {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export default function WorkoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [samples, setSamples] = useState<WorkoutSample[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiFetch<Workout>(`/workouts/${id}`), apiFetch<WorkoutSample[]>(`/workouts/${id}/samples`)]).then(
      ([w, s]) => {
        setWorkout(w);
        setSamples(s);
        setLoading(false);
      },
    );
  }, [id]);

  if (loading || !workout) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const showGraphs = workout.type === 'RUN' || workout.type === 'RIDE';
  const isRide = workout.type === 'RIDE';

  const paceOrSpeed = workout.distanceKm
    ? workout.type === 'RIDE'
      ? formatSpeed(workout.durationMin, workout.distanceKm)
      : workout.type === 'RUN' || workout.type === 'WALK'
        ? formatPace(workout.durationMin, workout.distanceKm)
        : null
    : null;

  const hrData = downsample(
    samples.filter((s) => s.heartRate != null),
    MAX_CHART_POINTS,
  ).map((s) => ({ offsetSec: s.offsetSec, value: s.heartRate ?? null }));

  const speedData = downsample(
    samples.filter((s) => s.speedMps != null && s.speedMps > 0),
    MAX_CHART_POINTS,
  ).map((s) => ({
    offsetSec: s.offsetSec,
    value: isRide ? s.speedMps! * 3.6 : 1000 / s.speedMps! / 60,
  }));

  const powerData = downsample(
    samples.filter((s) => s.powerWatts != null),
    MAX_CHART_POINTS,
  ).map((s) => ({ offsetSec: s.offsetSec, value: s.powerWatts ?? null }));

  const hasAnySampleData = hrData.length > 0 || speedData.length > 0 || powerData.length > 0;

  return (
    <div className="page">
      <div className="workout-detail">
        <button type="button" className="secondary plan-back-button" onClick={() => navigate('/workouts')}>
          ← Back
        </button>

        <div className="workout-card-header">
          <h1 className="workout-detail-title">
            {workout.type === 'OTHER' && workout.notes ? workout.notes : (WORKOUT_LABELS[workout.type] ?? workout.type)}
          </h1>
          <Link to={`/workouts/${workout.id}/edit`}>
            <button type="button" className="secondary">
              Edit
            </button>
          </Link>
        </div>

        <p className="muted">{formatDateUTC(workout.date, { month: 'long', day: 'numeric', year: 'numeric' })}</p>

        <div className="workout-stat-tiles">
          <div className="workout-stat">
            <span className="workout-stat-value">{formatDuration(workout.durationMin)}</span>
            <span className="workout-stat-label">Duration</span>
          </div>
          {workout.distanceKm != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{formatDistance(workout.distanceKm)}</span>
              <span className="workout-stat-label">Distance</span>
            </div>
          )}
          {paceOrSpeed && (
            <div className="workout-stat">
              <span className="workout-stat-value">{paceOrSpeed}</span>
              <span className="workout-stat-label">{isRide ? 'Avg speed' : 'Avg pace'}</span>
            </div>
          )}
          {workout.calorieKcal != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.calorieKcal)}</span>
              <span className="workout-stat-label">Calories</span>
            </div>
          )}
          {workout.tss != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.tss)}</span>
              <span className="workout-stat-label">TSS</span>
            </div>
          )}
          {workout.kilojoules != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.kilojoules)}</span>
              <span className="workout-stat-label">Kilojoules</span>
            </div>
          )}
        </div>

        {workout.notes && workout.type !== 'OTHER' && <p className="muted">{workout.notes}</p>}

        {showGraphs && !hasAnySampleData && (
          <p className="muted">No detailed heart-rate, speed, or power data available for this workout.</p>
        )}

        {showGraphs && hrData.length > 0 && (
          <WorkoutSampleChart title="Heart rate" data={hrData} color="var(--chart-heart-rate)" unit="bpm" />
        )}

        {showGraphs && speedData.length > 0 && (
          <WorkoutSampleChart
            title={isRide ? 'Speed' : 'Pace'}
            data={speedData}
            color="var(--accent)"
            unit={isRide ? 'km/h' : 'min/km'}
            formatValue={isRide ? (v) => `${v.toFixed(1)} km/h` : (v) => paceMinutesToLabel(v)}
          />
        )}

        {showGraphs && isRide && powerData.length > 0 && (
          <WorkoutSampleChart title="Power" data={powerData} color="var(--chart-hrv)" unit="W" />
        )}
      </div>
    </div>
  );
}
