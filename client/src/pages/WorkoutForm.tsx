import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { ExerciseEntry, Workout, WorkoutType } from '../api/types';

const WORKOUT_TYPES: WorkoutType[] = ['RUN', 'RIDE', 'STRENGTH', 'SWIM', 'WALK', 'OTHER'];

interface ExerciseDraft {
  name: string;
  sets: string;
  reps: string;
  weightKg: string;
}

function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function WorkoutForm() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const [type, setType] = useState<WorkoutType>('RUN');
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [durationMin, setDurationMin] = useState('30');
  const [distanceKm, setDistanceKm] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    apiFetch<Workout>(`/workouts/${id}`).then((w) => {
      setType(w.type);
      setDate(toDateInputValue(new Date(w.date)));
      setDurationMin(String(w.durationMin));
      setDistanceKm(w.distanceKm != null ? String(w.distanceKm) : '');
      setNotes(w.notes ?? '');
      setExercises(
        w.exercises.map((e: ExerciseEntry) => ({
          name: e.name,
          sets: String(e.sets),
          reps: String(e.reps),
          weightKg: e.weightKg != null ? String(e.weightKg) : '',
        })),
      );
      setLoading(false);
    });
  }, [id, isNew]);

  function addExercise() {
    setExercises((prev) => [...prev, { name: '', sets: '3', reps: '10', weightKg: '' }]);
  }

  function updateExercise(index: number, patch: Partial<ExerciseDraft>) {
    setExercises((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        type,
        date: new Date(date).toISOString(),
        durationMin: Number(durationMin),
        distanceKm: distanceKm ? Number(distanceKm) : undefined,
        notes: notes || undefined,
        exercises:
          type === 'STRENGTH'
            ? exercises
                .filter((ex) => ex.name.trim())
                .map((ex) => ({
                  name: ex.name,
                  sets: Number(ex.sets),
                  reps: Number(ex.reps),
                  weightKg: ex.weightKg ? Number(ex.weightKg) : undefined,
                }))
            : undefined,
      };

      if (isNew) {
        await apiFetch('/workouts', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/workouts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      navigate('/workouts');
    } catch {
      setError('Could not save workout. Check the fields and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this workout?')) return;
    await apiFetch(`/workouts/${id}`, { method: 'DELETE' });
    navigate('/workouts');
  }

  if (loading) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{isNew ? 'Log workout' : 'Edit workout'}</h1>
      </header>

      <form className="card form" onSubmit={handleSubmit}>
        {error && <div className="alert">{error}</div>}

        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as WorkoutType)}>
            {WORKOUT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <label>
          Date &amp; time
          <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label>
          Duration (minutes)
          <input
            type="number"
            min={1}
            required
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </label>

        {type !== 'STRENGTH' && (
          <label>
            Distance (km)
            <input
              type="number"
              min={0}
              step="0.01"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />
          </label>
        )}

        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        {type === 'STRENGTH' && (
          <div className="exercise-editor">
            <div className="card-header-row">
              <h3>Exercises</h3>
              <button type="button" className="secondary" onClick={addExercise}>
                + Add
              </button>
            </div>
            {exercises.map((ex, i) => (
              <div className="exercise-row" key={i}>
                <div className="exercise-row-top">
                  <input
                    placeholder="Exercise name"
                    value={ex.name}
                    onChange={(e) => updateExercise(i, { name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeExercise(i)}
                    aria-label="Remove exercise"
                  >
                    ✕
                  </button>
                </div>
                <div className="exercise-row-bottom">
                  <input
                    type="number"
                    placeholder="Sets"
                    min={1}
                    value={ex.sets}
                    onChange={(e) => updateExercise(i, { sets: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Reps"
                    min={1}
                    value={ex.reps}
                    onChange={(e) => updateExercise(i, { reps: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="kg"
                    min={0}
                    step="0.5"
                    value={ex.weightKg}
                    onChange={(e) => updateExercise(i, { weightKg: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save workout'}
          </button>
          {!isNew && (
            <button type="button" className="danger" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
