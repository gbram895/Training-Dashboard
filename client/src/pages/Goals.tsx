import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { Goal, GoalSuggestion } from '../api/types';

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('km');
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<GoalSuggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [addingSuggestion, setAddingSuggestion] = useState<number | null>(null);

  function reload() {
    return apiFetch<Goal[]>('/goals').then(setGoals);
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/goals', {
        method: 'POST',
        body: JSON.stringify({ title, targetValue: Number(targetValue), unit }),
      });
      setTitle('');
      setTargetValue('');
      setUnit('km');
      setShowForm(false);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function updateProgress(goal: Goal, currentValue: number) {
    await apiFetch(`/goals/${goal.id}`, {
      method: 'PUT',
      body: JSON.stringify({ currentValue }),
    });
    await reload();
  }

  async function removeGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    await apiFetch(`/goals/${id}`, { method: 'DELETE' });
    await reload();
  }

  async function requestSuggestions() {
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const result = await apiFetch<{ suggestions: GoalSuggestion[] }>('/goals/suggest', { method: 'POST' });
      setSuggestions(result.suggestions);
    } catch (err) {
      setSuggestError(err instanceof ApiError ? err.message : 'Failed to get goal suggestions');
    } finally {
      setSuggestLoading(false);
    }
  }

  async function acceptSuggestion(index: number, suggestion: GoalSuggestion) {
    setAddingSuggestion(index);
    try {
      await apiFetch('/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: suggestion.title,
          targetValue: suggestion.targetValue,
          unit: suggestion.unit,
          deadline: suggestion.deadline ?? undefined,
        }),
      });
      setSuggestions((prev) => prev?.filter((_, i) => i !== index) ?? null);
      await reload();
    } finally {
      setAddingSuggestion(null);
    }
  }

  function dismissSuggestion(index: number) {
    setSuggestions((prev) => prev?.filter((_, i) => i !== index) ?? null);
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Goals</h1>
      </header>

      <div className="goal-suggest-bar">
        <button type="button" className="secondary" onClick={requestSuggestions} disabled={suggestLoading}>
          {suggestLoading ? 'Thinking…' : '✨ Suggest goals with AI'}
        </button>
        {suggestError && <p className="muted">{suggestError}</p>}
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="goal-grid">
          {suggestions.map((s, i) => (
            <div className="card goal-card goal-suggestion-card" key={i}>
              <h2>{s.title}</h2>
              <p className="muted">
                {s.targetValue} {s.unit}
                {s.deadline && ` by ${new Date(s.deadline).toLocaleDateString()}`}
              </p>
              <p className="goal-suggestion-rationale">{s.rationale}</p>
              <div className="form-actions">
                <button type="button" disabled={addingSuggestion === i} onClick={() => acceptSuggestion(i, s)}>
                  {addingSuggestion === i ? 'Adding…' : 'Add goal'}
                </button>
                <button type="button" className="secondary" onClick={() => dismissSuggestion(i)}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : goals.length === 0 && !showForm ? (
        <p className="muted">No goals yet.</p>
      ) : (
        <div className="goal-grid">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.currentValue / g.targetValue) * 100));
            return (
              <div className="card goal-card" key={g.id}>
                <div className="card-header-row">
                  <h2>{g.title}</h2>
                  <button className="icon-button" onClick={() => removeGoal(g.id)}>
                    ✕
                  </button>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="muted">
                  {g.currentValue} / {g.targetValue} {g.unit} ({pct}%)
                </p>
                <input
                  type="number"
                  className="progress-input"
                  defaultValue={g.currentValue}
                  onBlur={(e) => updateProgress(g, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>
      )}

      {showForm ? (
        <form className="card form" onSubmit={handleCreate}>
          <label>
            Goal
            <input
              required
              placeholder="e.g. Run 100km this month"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="inline-fields">
            <label>
              Target
              <input
                type="number"
                required
                min={0}
                step="0.1"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
              />
            </label>
            <label>
              Unit
              <input required value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add goal'}
            </button>
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="secondary" onClick={() => setShowForm(true)}>
          + New goal
        </button>
      )}
    </div>
  );
}
