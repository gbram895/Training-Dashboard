import { useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import type { TimeWindow, TrainingPlanConfig, TrainingWindows } from '../api/types';
import TimeSlotsEditor, { slotIsValid } from './plan/TimeSlotsEditor';
import Sheet, { type SheetDismiss } from './Sheet';

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
  const sheet = useRef<SheetDismiss | null>(null);
  const [weeklyHours, setWeeklyHours] = useState(initialConfig?.weeklyHours ?? 5);
  const [dayHours, setDayHours] = useState<Record<string, number>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, initialConfig?.[d.key] ?? 0])),
  );
  const [includeRunning, setIncludeRunning] = useState(initialConfig?.includeRunning ?? false);
  const [runDays, setRunDays] = useState<Set<number>>(new Set(initialConfig?.runDays ?? []));
  // When in the day each weekday's training can go, as up to MAX_SLOTS slots
  // per day. A day without any is "any time"; the plan then fits it around
  // the calendar alone, if one is connected.
  const [windows, setWindows] = useState<TrainingWindows>(() => initialConfig?.trainingWindows ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allocated = Object.values(dayHours).reduce((a, b) => a + b, 0);

  function setSlots(jsDay: number, slots: TimeWindow[]) {
    setWindows((prev) => {
      const next = { ...prev };
      if (slots.length) next[String(jsDay)] = slots;
      else delete next[String(jsDay)];
      return next;
    });
  }

  /** The same slots on every other day that has training hours. */
  function copyToOthers(jsDay: number) {
    const slots = windows[String(jsDay)] ?? [];
    setWindows((prev) => {
      const next = { ...prev };
      for (const d of DAYS) if (d.jsDay !== jsDay && dayHours[d.key] > 0) next[String(d.jsDay)] = slots.map((s) => ({ ...s }));
      return next;
    });
  }

  const invalidWindow = DAYS.some(
    (d) => dayHours[d.key] > 0 && (windows[String(d.jsDay)] ?? []).some((w) => !slotIsValid(w)),
  );

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
      // Slide the sheet away first, then hand the result back.
      if (sheet.current) sheet.current(onSaved);
      else onSaved();
    } catch {
      setError('Could not save your plan. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} dismissRef={sheet}>
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
        Add the times you can train on each day and the session is planned inside one of them, around anything in
        your calendar. With no times, only the hours count.
      </p>

      <div className="plan-day-sliders">
        {DAYS.map((d) => (
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
            {dayHours[d.key] > 0 && (
              <TimeSlotsEditor
                dayLabel={d.label}
                slots={windows[String(d.jsDay)] ?? []}
                onChange={(slots) => setSlots(d.jsDay, slots)}
                onCopyToOthers={() => copyToOthers(d.jsDay)}
              />
            )}
          </div>
        ))}
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
        <button type="button" className="secondary" onClick={() => sheet.current?.()} disabled={saving}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
