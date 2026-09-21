import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api/client';
import type { TrainingPhase, TrainingTarget } from '../../api/types';

const PHASE_LABEL: Record<TrainingPhase, string> = {
  BUILD: 'Build week',
  RECOVERY: 'Recovery week',
  TAPER: 'Taper',
  EVENT: 'Race day',
};

function daysUntil(iso: string): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Without a target the plan only ever reacts — it holds you at the fitness you
 * already have and makes days easier when you're tired. Setting one turns the
 * standing weekly hours into a trajectory: a ramp toward the date, a lighter
 * week every fourth, and a taper into it.
 */
export default function TargetCard({
  phase,
  phaseWeek,
  onChanged,
}: {
  phase?: TrainingPhase | null;
  phaseWeek?: number | null;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<TrainingTarget | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [rampPerWeek, setRampPerWeek] = useState('4');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<TrainingTarget | null>('/training-plan/target')
      .then((t) => {
        setTarget(t);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(load, []);

  function startEdit() {
    setName(target?.name ?? '');
    setDate(target?.date ? target.date.slice(0, 10) : '');
    setRampPerWeek(String(target?.rampPerWeek ?? 4));
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await apiFetch<TrainingTarget>('/training-plan/target', {
        method: 'PUT',
        body: JSON.stringify({ name, date, rampPerWeek: Number(rampPerWeek) }),
      });
      setTarget(saved);
      setEditing(false);
      onChanged();
    } catch {
      setError('Could not save that. Check the date is in the future.');
    } finally {
      setSaving(false);
    }
  }

  async function clearTarget() {
    if (!confirm('Remove this target? Your plan goes back to holding your current fitness.')) return;
    await apiFetch('/training-plan/target', { method: 'DELETE' });
    setTarget(null);
    setEditing(false);
    onChanged();
  }

  if (!loaded) return null;

  if (editing || !target) {
    return (
      <div className="gd-target-card">
        <form onSubmit={save}>
          <div className="gd-sec-title">
            <span className="gd-flag" />
            <h4>{target ? 'Edit target' : 'Train toward something'}</h4>
          </div>
          {!target && (
            <p className="gd-set-note">
              Give the plan a date and it builds toward it — a bit more each week, a lighter fourth week, and a
              taper at the end. Without one it just keeps you where you are.
            </p>
          )}
          <label className="gd-target-field">
            <span>What is it?</span>
            <input
              className="gd-set-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gravel race, 100k, first half marathon…"
              maxLength={80}
              required
            />
          </label>
          <label className="gd-target-field">
            <span>When?</span>
            <input
              className="gd-set-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label className="gd-target-field">
            <span>How hard to build</span>
            <select className="gd-set-input" value={rampPerWeek} onChange={(e) => setRampPerWeek(e.target.value)}>
              <option value="2">Gently</option>
              <option value="4">Steady</option>
              <option value="6">Aggressively</option>
            </select>
          </label>
          {error && <p className="gd-cal-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="gd-set-save" disabled={saving}>
              {saving ? 'Saving…' : target ? 'Save' : 'Start building'}
            </button>
            {target && (
              <button type="button" className="gd-why-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  const days = daysUntil(target.date);

  return (
    <div className="gd-target-card">
      <div className="gd-target-head">
        <div>
          <p className="gd-target-name">{target.name}</p>
          <p className="gd-target-when">
            {formatDate(target.date)} · {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} to go`}
          </p>
        </div>
        {phase && (
          <span className={`gd-phase-pill gd-phase-${phase.toLowerCase()}`}>
            {PHASE_LABEL[phase]}
            {phase === 'BUILD' && phaseWeek ? ` ${phaseWeek}` : ''}
          </span>
        )}
      </div>
      <div className="gd-target-actions">
        <button type="button" className="gd-why-btn" onClick={startEdit}>
          Edit
        </button>
        <button type="button" className="gd-why-btn gd-set-danger" onClick={clearTarget}>
          Remove
        </button>
      </div>
    </div>
  );
}
