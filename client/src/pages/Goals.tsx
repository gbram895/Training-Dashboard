import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import type { Goal } from '../api/types';
import { useCachedState } from '../lib/pageCache';
import PageHead from '../components/PageHead';
import ProgressRing from '../components/ProgressRing';

export default function Goals() {
  const [goals, setGoals] = useCachedState<Goal[] | null>('goals.list', null);
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
    reload();
  }, []);

  const loading = goals === null;
  const list = goals ?? [];

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
      <div className="gd-goals-top">
        <PageHead title="Goals" />

        <form className="gd-set-card goal-search-form" onSubmit={openWebSearch}>
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
        ) : list.length === 0 && !showForm ? (
          <p className="muted">No goals yet.</p>
        ) : (
          <div className="goal-grid">
            {list.map((g) => {
              const pct = Math.min(100, Math.round((g.currentValue / g.targetValue) * 100));
              return (
                <div className="gd-goal-card" key={g.id}>
                  <ProgressRing percent={pct} size={58} strokeWidth={6} gradientId={`goalRing-${g.id}`}>
                    <span className="gd-gr-num mono">{pct}%</span>
                  </ProgressRing>
                  <div className="gd-goal-info">
                    <div className="gd-goal-info-head">
                      <p className="gd-g-title">{g.title}</p>
                      <button type="button" className="gd-goal-remove" onClick={() => removeGoal(g.id)} aria-label="Delete goal">
                        ✕
                      </button>
                    </div>
                    <p className="gd-g-sub">
                      {g.currentValue} / {g.targetValue} {g.unit}
                    </p>
                    <p className="gd-g-target mono">
                      Target {g.targetValue} {g.unit}
                      {g.deadline && ` · by ${new Date(g.deadline).toLocaleDateString()}`}
                    </p>
                    {g.notes && <p className="gd-g-notes">{g.notes}</p>}
                    <div className="gd-goal-progress-row">
                      <label htmlFor={`goal-progress-${g.id}`}>Update:</label>
                      <input
                        id={`goal-progress-${g.id}`}
                        type="number"
                        className="gd-goal-progress-input"
                        defaultValue={g.currentValue}
                        onBlur={(e) => updateProgress(g, Number(e.target.value))}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showForm ? (
          <form className="gd-set-card form" onSubmit={handleCreate}>
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
          <button type="button" className="gd-dashed-fab" onClick={() => setShowForm(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New goal
          </button>
        )}
      </div>
    </div>
  );
}
