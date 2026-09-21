import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import type { TssSource, Workout, WorkoutSample } from '../api/types';
import { formatDateUTC, formatDistance, formatDuration, formatPace, formatSpeed } from '../lib/format';
import WorkoutSampleChart from '../components/WorkoutSampleChart';

// Training load is measured from power where it exists, pace where it doesn't,
// and time-in-zone for everything else — worth saying, since the three are not
// equally precise and the last one is what makes badminton and hikes count.
const TSS_SOURCE_LABEL: Record<TssSource, string> = {
  POWER: ' from power',
  PACE: ' from pace',
  HR: ' from heart rate',
};

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

  const [rpe, setRpe] = useState<number | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<Workout>(`/workouts/${id}`), apiFetch<WorkoutSample[]>(`/workouts/${id}/samples`)]).then(
      ([w, s]) => {
        setWorkout(w);
        setSamples(s);
        setRpe(w.rpe ?? null);
        setFeedbackNotes(w.feedbackNotes ?? '');
        setLoading(false);
      },
    );
  }, [id]);

  async function saveFeedback() {
    setFeedbackSaving(true);
    setFeedbackError(null);
    try {
      const updated = await apiFetch<Workout>(`/workouts/${id}/feedback`, {
        method: 'PATCH',
        body: JSON.stringify({ rpe, feedbackNotes: feedbackNotes.trim() || null }),
      });
      setWorkout(updated);
      setFeedbackSaved(true);
      setTimeout(() => setFeedbackSaved(false), 3000);
    } catch (err) {
      setFeedbackError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setFeedbackSaving(false);
    }
  }

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
              <span className="workout-stat-label">TSS{TSS_SOURCE_LABEL[workout.tssSource ?? 'POWER']}</span>
            </div>
          )}
          {workout.kilojoules != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.kilojoules)}</span>
              <span className="workout-stat-label">Kilojoules</span>
            </div>
          )}
          {workout.avgPowerWatts != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.avgPowerWatts)} W</span>
              <span className="workout-stat-label">Avg power</span>
            </div>
          )}
          {workout.normalizedPowerWatts != null && (
            <div className="workout-stat">
              <span className="workout-stat-value">{Math.round(workout.normalizedPowerWatts)} W</span>
              <span className="workout-stat-label">Normalized power</span>
            </div>
          )}
        </div>

        {workout.notes && workout.type !== 'OTHER' && <p className="muted">{workout.notes}</p>}

        <div className="gd-set-group">
          <p className="gd-set-group-label">How did it feel?</p>
          <div className="gd-rpe-row">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`gd-rpe-btn${rpe === n ? ' gd-on' : ''}`}
                onClick={() => setRpe(rpe === n ? null : n)}
                aria-pressed={rpe === n}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            className="gd-rpe-notes"
            placeholder="Notes — how it went, how you felt, anything worth remembering (optional)"
            value={feedbackNotes}
            onChange={(e) => setFeedbackNotes(e.target.value)}
            rows={3}
          />
          {feedbackError && <p className="gd-set-note gd-set-danger">{feedbackError}</p>}
          <button type="button" className="gd-set-save" onClick={saveFeedback} disabled={feedbackSaving}>
            {feedbackSaving ? 'Saving…' : feedbackSaved ? 'Saved ✓' : 'Save feedback'}
          </button>
        </div>

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
