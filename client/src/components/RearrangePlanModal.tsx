import { useRef, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { PlannedDay } from '../api/types';
import { weekdayLabel } from '../lib/planDates';

function rowSummary(day: PlannedDay): { icon: string; label: string } {
  if (day.isRestDay) return { icon: '😌', label: 'Rest day' };
  return { icon: day.discipline === 'RUN' ? '🏃' : '🚴', label: day.name ?? 'Workout' };
}

export default function RearrangePlanModal({
  week,
  onClose,
  onSwapped,
}: {
  week: PlannedDay[];
  onClose: () => void;
  onSwapped: (week: PlannedDay[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ pointerId: number; index: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, index: number) {
    if (swapping) return;
    dragRef.current = { pointerId: e.pointerId, index };
    setDragIndex(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest<HTMLElement>('[data-row-index]');
    setOverIndex(row ? Number(row.dataset.rowIndex) : null);
  }

  async function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    dragRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
    if (!state || e.pointerId !== state.pointerId) return;

    const from = state.index;
    const to = overIndex;
    if (to == null || to === from) return;

    setSwapping(true);
    setError(null);
    try {
      const updated = await apiFetch<PlannedDay[]>('/training-plan/swap', {
        method: 'PUT',
        body: JSON.stringify({ dateA: week[from].date, dateB: week[to].date }),
      });
      onSwapped(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rearrange plan');
    } finally {
      setSwapping(false);
    }
  }

  function onPointerCancel() {
    dragRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h2>Rearrange days</h2>
        <p className="muted">Press and drag a day onto another to swap what's planned between them.</p>

        <div className="gd-rearrange-list">
          {week.map((day, i) => {
            const { name, date, isToday } = weekdayLabel(day.date);
            const { icon, label } = rowSummary(day);
            return (
              <div
                key={day.id}
                data-row-index={i}
                className={`gd-rearrange-row${dragIndex === i ? ' gd-dragging' : ''}${
                  overIndex === i && dragIndex !== null && dragIndex !== i ? ' gd-drop-target' : ''
                }`}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <span className="gd-rearrange-handle" aria-hidden="true">
                  ⠿
                </span>
                <div className="gd-rearrange-info">
                  <span className="gd-rearrange-day">
                    {name}
                    {isToday ? ' · Today' : ''}
                  </span>
                  <span className="gd-rearrange-date">{date}</span>
                </div>
                <span className="gd-rearrange-summary">
                  {icon} {label}
                </span>
                {day.manualOverride && (
                  <span title="Manually rearranged" aria-hidden="true">
                    📌
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
