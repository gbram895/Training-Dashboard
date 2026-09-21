import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api/client';
import type { TargetPriority, TrainingTarget, TrainingTargets } from '../../api/types';

/**
 * What each tier actually does to the calendar, in the athlete's terms rather
 * than the coaching vocabulary. This is the whole answer to "what happens when
 * two goals want the same fortnight", so it's spelled out in the picker itself
 * rather than hidden behind a help link.
 */
const PRIORITY_INFO: Record<TargetPriority, { label: string; blurb: string }> = {
  A: { label: 'Peak for it', blurb: 'The year builds toward it, with a full taper and a week easy afterwards.' },
  B: { label: 'Want to go well', blurb: 'A few easy days before, a couple after. The build carries on around it.' },
  C: { label: 'Train through it', blurb: "It's on the calendar, but the week around it doesn't change." },
};

const PRIORITY_ORDER: TargetPriority[] = ['A', 'B', 'C'];

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

function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days < 0) return 'done';
  if (days < 21) return `${days} day${days === 1 ? '' : 's'} to go`;
  return `${Math.round(days / 7)} weeks`;
}

interface Draft {
  id: string | null;
  name: string;
  date: string;
  priority: TargetPriority;
  rampPerWeek: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: '', date: '', priority: 'A', rampPerWeek: '4' };

/**
 * Every event the athlete is building toward, over however long they want to
 * plan for.
 *
 * With none, the plan only ever reacts — it holds you at the fitness you
 * already have and makes days easier when you're tired. With several, the plan
 * periodises them together: it builds toward the one marked "peak for it" while
 * still tapering into, and recovering from, everything else on the list.
 */
export default function GoalsCard({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<TrainingTargets | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  function load() {
    apiFetch<TrainingTargets>('/training-plan/targets')
      .then((d) => {
        setData(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(load, []);

  function startAdd() {
    setError(null);
    setDraft({ ...EMPTY_DRAFT, priority: data?.targets.length ? 'B' : 'A' });
  }

  function startEdit(target: TrainingTarget) {
    setError(null);
    setDraft({
      id: target.id,
      name: target.name,
      date: target.date.slice(0, 10),
      priority: target.priority,
      rampPerWeek: String(target.rampPerWeek),
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    const body = JSON.stringify({
      name: draft.name,
      date: draft.date,
      priority: draft.priority,
      rampPerWeek: Number(draft.rampPerWeek),
    });
    try {
      await apiFetch(draft.id ? `/training-plan/targets/${draft.id}` : '/training-plan/targets', {
        method: draft.id ? 'PUT' : 'POST',
        body,
      });
      setDraft(null);
      load();
      onChanged();
    } catch {
      setError('Could not save that. Check the date is in the future.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(target: TrainingTarget) {
    if (!confirm(`Remove ${target.name}? The rest of your plan rebuilds around what's left.`)) return;
    await apiFetch(`/training-plan/targets/${target.id}`, { method: 'DELETE' });
    setDraft(null);
    load();
    onChanged();
  }

  if (!loaded) return null;

  const targets = data?.targets ?? [];
  const upcoming = targets.filter((t) => daysUntil(t.date) >= 0);
  const past = targets.filter((t) => daysUntil(t.date) < 0);

  if (draft) {
    return (
      <div className="gd-target-card">
        <form onSubmit={save}>
          <div className="gd-sec-title">
            <span className="gd-flag" />
            <h4>{draft.id ? 'Edit goal' : 'Add a goal'}</h4>
          </div>
          <label className="gd-target-field">
            <span>What is it?</span>
            <input
              className="gd-set-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
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
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              required
            />
          </label>
          <div className="gd-target-field">
            <span>How much does it matter?</span>
            <div className="gd-priority-picker">
              {PRIORITY_ORDER.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`gd-priority-opt${draft.priority === p ? ' gd-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, priority: p })}
                >
                  <span className={`gd-priority-tag gd-priority-${p.toLowerCase()}`}>{p}</span>
                  <span className="gd-priority-label">{PRIORITY_INFO[p].label}</span>
                  <span className="gd-priority-blurb">{PRIORITY_INFO[p].blurb}</span>
                </button>
              ))}
            </div>
          </div>
          {draft.priority === 'A' && (
            <label className="gd-target-field">
              <span>How hard to build</span>
              <select
                className="gd-set-input"
                value={draft.rampPerWeek}
                onChange={(e) => setDraft({ ...draft, rampPerWeek: e.target.value })}
              >
                <option value="2">Gently</option>
                <option value="4">Steady</option>
                <option value="6">Aggressively</option>
              </select>
            </label>
          )}
          {error && <p className="gd-cal-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="gd-set-save" disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save' : 'Add goal'}
            </button>
            <button type="button" className="gd-why-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {draft.id && (
              <button
                type="button"
                className="gd-why-btn gd-set-danger"
                onClick={() => {
                  const t = targets.find((x) => x.id === draft.id);
                  if (t) remove(t);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  if (upcoming.length === 0) {
    return (
      <div className="gd-target-card">
        <div className="gd-sec-title">
          <span className="gd-flag" />
          <h4>Train toward something</h4>
        </div>
        <p className="gd-set-note">
          Add everything you're aiming at this year — a big one, the club races along the way, all of it. The plan
          builds toward the one you care most about while still tapering into and recovering from the rest. Without
          any, it just keeps you where you are.
        </p>
        <div className="form-actions">
          <button type="button" className="gd-set-save" onClick={startAdd}>
            Add a goal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gd-target-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>Your goals</h4>
      </div>

      <ul className="gd-goal-list">
        {upcoming.map((t) => {
          const days = daysUntil(t.date);
          return (
            <li key={t.id}>
              <button type="button" className="gd-goal-row" onClick={() => startEdit(t)}>
                <span className={`gd-priority-tag gd-priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                <span className="gd-goal-main">
                  <span className="gd-goal-name">{t.name}</span>
                  <span className="gd-goal-when">
                    {formatDate(t.date)} · {countdown(days)}
                  </span>
                </span>
                {data?.anchorId === t.id && <span className="gd-goal-anchor">main goal</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {data?.conflicts.map((warning) => (
        <p key={warning} className="gd-goal-conflict">
          {warning}
        </p>
      ))}

      {past.length > 0 && (
        <div className="gd-goal-past">
          <button type="button" className="gd-why-btn" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide' : 'Show'} {past.length} goal{past.length === 1 ? '' : 's'} already behind you
          </button>
          {/* Past goals no longer shape the plan, but they shouldn't pile up
              with no way to clear them either. Removable, not editable — the
              API won't take a date that has already passed. */}
          {showPast && (
            <ul className="gd-goal-list">
              {past.map((t) => (
                <li key={t.id}>
                  <div className="gd-goal-row gd-goal-row-static">
                    <span className={`gd-priority-tag gd-priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    <span className="gd-goal-main">
                      <span className="gd-goal-name">{t.name}</span>
                      <span className="gd-goal-when">{formatDate(t.date)}</span>
                    </span>
                    <button
                      type="button"
                      className="gd-goal-remove"
                      onClick={() => remove(t)}
                      aria-label={`Remove ${t.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="gd-target-actions">
        <button type="button" className="gd-why-btn" onClick={startAdd}>
          Add a goal
        </button>
      </div>
    </div>
  );
}
