import { useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { PlannedDay, TrainingPlanConfig } from '../api/types';
import { configHoursForDate, weekdayLabel } from '../lib/planDates';

function formatHours(h: number): string {
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m`;
  if (min === 0) return `${hours}h`;
  return `${hours}h ${min}m`;
}

export default function WeeklyAvailabilityModal({
  week,
  config,
  onClose,
  onSaved,
}: {
  week: PlannedDay[];
  config: TrainingPlanConfig | null | undefined;
  onClose: () => void;
  onSaved: (week: PlannedDay[]) => void;
}) {
  const [hours, setHours] = useState<Record<string, number>>(() =>
    Object.fromEntries(week.map((d) => [d.id, d.availableHoursOverride ?? configHoursForDate(config, d.date)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const changed = week.filter((d) => hours[d.id] !== (d.availableHoursOverride ?? configHoursForDate(config, d.date)));
      // Sequential, not parallel — each call re-runs the whole window
      // projection, and concurrent calls could race on that regeneration.
      for (const day of changed) {
        await apiFetch('/training-plan/day-availability', {
          method: 'PUT',
          body: JSON.stringify({ date: day.date, hours: hours[day.id] }),
        });
      }
      const updated = await apiFetch<PlannedDay[]>('/training-plan/week');
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save availability');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h2>Next week's availability</h2>
        <p className="muted">How much time do you have on each day? Gradient will replan around it.</p>

        <div className="plan-day-sliders">
          {week.map((day) => {
            const { name, date, isToday } = weekdayLabel(day.date);
            return (
              <label className="plan-slider-row" key={day.id}>
                <div className="plan-slider-label">
                  <span>
                    {name}
                    {isToday ? ' · Today' : ` · ${date}`}
                  </span>
                  <span className="plan-slider-value">{formatHours(hours[day.id])}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.25}
                  value={hours[day.id]}
                  onChange={(e) => setHours((prev) => ({ ...prev, [day.id]: Number(e.target.value) }))}
                />
              </label>
            );
          })}
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="form-actions">
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
