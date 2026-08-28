import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import type { Goal } from '../api/types';

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('km');
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');

  function reload() {
    return apiFetch<Goal[]>('/goals').then(setGoals);
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
  }, []);

  function resetForm() {
    setTitle('');
    setTargetValue('');
    setUnit('km');
    setDeadline('');
    setNotes('');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/goals', {
        method: 'POST',
        body: JSON.stringify({
          title,
          targetValue: Number(targetValue),
          unit,
          deadline: deadline || undefined,
          notes: notes || undefined,
        }),
      });
      resetForm();
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

  function openWebSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Goals</h1>
      </header>

      <form className="card goal-search-form" onSubmit={openWebSearch}>
        <label>
          Search the web for an event
          <input
            placeholder="e.g. marathons in the Netherlands spring 2026"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={!searchQuery.trim()}>
            🔍 Search
          </button>
        </div>
        <p className="muted">Opens a web search in a new tab — bring back what you find and add it below.</p>
      </form>

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
                  {g.deadline && ` · by ${new Date(g.deadline).toLocaleDateString()}`}
                </p>
                {g.notes && <p className="goal-notes">{g.notes}</p>}
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
            <label>
              Deadline
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          </div>
          <label>
            Notes
            <textarea
              placeholder="Optional details - location, why this goal, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add goal'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
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
