import { useState } from 'react';
import { apiFetch } from '../api/client';
import type { TimeWindow, TrainingPlanConfig, TrainingWindows } from '../api/types';

const DAYS: { key: keyof Pick<TrainingPlanConfig, 'mondayHours' | 'tuesdayHours' | 'wednesdayHours' | 'thursdayHours' | 'fridayHours' | 'saturdayHours' | 'sundayHours'>; label: string; jsDay: number }[] = [
  { key: 'mondayHours', label: 'Monday', jsDay: 1 },
  { key: 'tuesdayHours', label: 'Tuesday', jsDay: 2 },
  { key: 'wednesdayHours', label: 'Wednesday', jsDay: 3 },
  { key: 'thursdayHours', label: 'Thursday', jsDay: 4 },
  { key: 'fridayHours', label: 'Friday', jsDay: 5 },
  { key: 'saturdayHours', label: 'Saturday', jsDay: 6 },
  { key: 'sundayHours', label: 'Sunday', jsDay: 0 },
];

function formatHours(h: number): string {
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m`;
  if (min === 0) return `${hours}h`;
  return `${hours}h ${min}m`;
}

export default function NewPlanModal({
  initialConfig,
  onClose,
  onSaved,
}: {
  initialConfig: TrainingPlanConfig | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [weeklyHours, setWeeklyHours] = useState(initialConfig?.weeklyHours ?? 5);
  const [dayHours, setDayHours] = useState<Record<string, number>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, initialConfig?.[d.key] ?? 0])),
  );
  const [includeRunning, setIncludeRunning] = useState(initialConfig?.includeRunning ?? false);
  const [runDays, setRunDays] = useState<Set<number>>(new Set(initialConfig?.runDays ?? []));
  // When in the day each weekday's training can go. A day without one is
  // "any time"; the plan then fits it around the calendar alone, if one is
  // connected. One window per day here — the API takes up to three, and any
  // extra ones saved elsewhere are kept as they are.
  const [windows, setWindows] = useState<TrainingWindows>(() => initialConfig?.trainingWindows ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allocated = Object.values(dayHours).reduce((a, b) => a + b, 0);

  function setWindow(jsDay: number, window: TimeWindow | null) {
    setWindows((prev) => {
      const next = { ...prev };
      const rest = (prev[String(jsDay)] ?? []).slice(1);
      if (window) next[String(jsDay)] = [window, ...rest];
      else if (rest.length) next[String(jsDay)] = rest;
      else delete next[String(jsDay)];
      return next;
    });
  }

  const invalidWindow = DAYS.some((d) => {
    const w = windows[String(d.jsDay)]?.[0];
    return dayHours[d.key] > 0 && w && !(w.start < w.end);
  });

  function toggleRunDay(jsDay: number) {
    setRunDays((prev) => {
      const next = new Set(prev);
      if (next.has(jsDay)) next.delete(jsDay);
      else next.add(jsDay);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/training-plan/config', {
        method: 'POST',
        body: JSON.stringify({
          weeklyHours,
          ...dayHours,
          includeRunning,
          runDays: Array.from(runDays),
          // Only the days with hours keep a window: a window on a day off
          // would only confuse the next person to open this.
          trainingWindows: Object.fromEntries(
            Object.entries(windows).filter(
              ([day, list]) => list?.length && dayHours[DAYS.find((d) => String(d.jsDay) === day)!.key] > 0,
            ),
          ),
        }),
      });
      onSaved();
    } catch {
      setError('Could not save your plan. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h2>New training plan</h2>
        <p className="muted">
          Set how much you want to train, and the app will pick a workout — or a rest day — for you each day based
          on your fitness and recovery.
        </p>

        <label className="plan-slider-row">
          <div className="plan-slider-label">
            <span>Weekly hours target</span>
            <span className="plan-slider-value">{formatHours(weeklyHours)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={20}
            step={0.25}
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(Number(e.target.value))}
          />
        </label>
        <p className="muted plan-allocated-note">
          {formatHours(allocated)} allocated across the days below{weeklyHours > 0 ? ` of your ${formatHours(weeklyHours)} target` : ''}
        </p>

        <p className="muted plan-allocated-note">
          Set a time for a day and its session is planned inside it, around anything in your calendar. Leave it on
          "any time" and only the hours count.
        </p>

        <div className="plan-day-sliders">
          {DAYS.map((d) => {
            const window = windows[String(d.jsDay)]?.[0] ?? null;
            return (
              <div className="plan-slider-row" key={d.key}>
                <label className="plan-slider-row">
                  <div className="plan-slider-label">
                    <span>{d.label}</span>
                    <span className="plan-slider-value">{formatHours(dayHours[d.key])}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.25}
                    value={dayHours[d.key]}
                    onChange={(e) => setDayHours((prev) => ({ ...prev, [d.key]: Number(e.target.value) }))}
                  />
                </label>
                {dayHours[d.key] > 0 &&
                  (window ? (
                    <div className="plan-window-row">
                      <span>Between</span>
                      <input
                        type="time"
                        step={900}
                        value={window.start}
                        aria-label={`${d.label} earliest start`}
                        onChange={(e) => setWindow(d.jsDay, { ...window, start: e.target.value })}
                      />
                      <span>and</span>
                      <input
                        type="time"
                        step={900}
                        value={window.end}
                        aria-label={`${d.label} latest finish`}
                        onChange={(e) => setWindow(d.jsDay, { ...window, end: e.target.value })}
                      />
                      <button
                        type="button"
                        className="gd-no-time-btn"
                        onClick={() => setWindow(d.jsDay, null)}
                        aria-label={`${d.label}: any time`}
                      >
                        Any time
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="gd-no-time-btn plan-window-add"
                      onClick={() => {
                        // Weekends default to the morning, weekdays to after work.
                        const weekend = d.jsDay === 0 || d.jsDay === 6;
                        setWindow(d.jsDay, weekend ? { start: '08:00', end: '12:00' } : { start: '18:00', end: '21:00' });
                      }}
                    >
                      Any time · set a time
                    </button>
                  ))}
                {window && dayHours[d.key] > 0 && !(window.start < window.end) && (
                  <span className="plan-window-error">The end has to be after the start.</span>
                )}
              </div>
            );
          })}
        </div>

        <label className="plan-checkbox-row">
          <input
            type="checkbox"
            checked={includeRunning}
            onChange={(e) => setIncludeRunning(e.target.checked)}
          />
          Include running workouts
        </label>

        {includeRunning && (
          <div className="plan-run-days-panel">
            <p className="muted">Which days should be runs? (the rest stay rides)</p>
            <div className="plan-run-days-grid">
              {DAYS.map((d) => (
                <button
                  type="button"
                  key={d.key}
                  className={`plan-run-day-chip${runDays.has(d.jsDay) ? ' plan-run-day-chip-active' : ''}`}
                  onClick={() => toggleRunDay(d.jsDay)}
                >
                  {d.label.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="alert">{error}</div>}

        <div className="form-actions">
          <button type="button" onClick={save} disabled={saving || invalidWindow}>
            {saving ? 'Creating…' : 'Create plan'}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
