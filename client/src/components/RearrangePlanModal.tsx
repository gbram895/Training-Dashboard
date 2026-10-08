import { useRef, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { PlannedDay } from '../api/types';
import { weekdayLabel } from '../lib/planDates';
import Icon, { type IconName } from './Icon';
import { disciplineIcon } from '../lib/workoutTypes';
import Sheet, { type SheetDismiss } from './Sheet';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SETTLE_MS = 250;

function rowSummary(day: PlannedDay): { icon: IconName; label: string } {
  if (day.isRestDay) return { icon: 'rest', label: 'Rest day' };
  return { icon: disciplineIcon(day.discipline), label: day.name ?? 'Workout' };
}

/**
 * The days stay put and the sessions move: each session is a chip you pick up
 * and carry onto another day. The chip stays under your finger the whole way,
 * the session it would swap with slides across to show where it'll land, and
 * on release both settle into their new days before the server has answered,
 * so nothing jumps when the new week arrives.
 */
type Drag = {
  from: number;
  dy: number;
  over: number | null;
  // Row positions, measured when the chip is picked up. The sheet can't
  // scroll mid-carry, so they stay true until it's put down.
  rects: DOMRect[];
  // 'carry' while the finger is down; 'settle' while chips glide to rest.
  phase: 'carry' | 'settle';
};

export default function RearrangePlanModal({
  week,
  onClose,
  onSwapped,
}: {
  week: PlannedDay[];
  onClose: () => void;
  onSwapped: (week: PlannedDay[]) => void;
}) {
  const sheet = useRef<SheetDismiss | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; startY: number } | null>(null);
  const hasOverrides = week.some((d) => d.manualOverride);

  async function revert() {
    setReverting(true);
    setError(null);
    try {
      const updated = await apiFetch<PlannedDay[]>('/training-plan/revert', { method: 'POST' });
      onSwapped(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revert plan');
    } finally {
      setReverting(false);
    }
  }

  /** The row whose centre is nearest the carried chip's centre. */
  function rowUnder(rects: DOMRect[], from: number, dy: number): number {
    const centre = rects[from].top + rects[from].height / 2 + dy;
    let best = from;
    let bestDistance = Infinity;
    rects.forEach((r, i) => {
      const distance = Math.abs(r.top + r.height / 2 - centre);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, index: number) {
    if (swapping || drag || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-row-index]'));
    gesture.current = { pointerId: e.pointerId, startY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, dy: 0, over: null, rects: rows.map((r) => r.getBoundingClientRect()), phase: 'carry' });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId || !drag || drag.phase !== 'carry') return;
    const dy = e.clientY - g.startY;
    const over = rowUnder(drag.rects, drag.from, dy);
    setDrag({ ...drag, dy, over: over === drag.from ? null : over });
  }

  function settleBack() {
    setDrag((d) => (d ? { ...d, dy: 0, over: null, phase: 'settle' } : d));
    window.setTimeout(() => setDrag(null), SETTLE_MS);
  }

  async function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId || !drag) return;
    gesture.current = null;
    const { from, over } = drag;
    if (over == null) {
      settleBack();
      return;
    }

    // Let both chips glide into their new days while the swap is saved.
    setDrag({ ...drag, phase: 'settle' });
    setSwapping(true);
    setError(null);
    try {
      const [updated] = await Promise.all([
        apiFetch<PlannedDay[]>('/training-plan/swap', {
          method: 'PUT',
          body: JSON.stringify({ dateA: week[from].date, dateB: week[over].date }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS)),
      ]);
      // Same render: the new week puts each session where its chip already
      // sits, and clearing the drag drops the offsets with no transition.
      onSwapped(updated);
      setDrag(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rearrange plan');
      settleBack();
    } finally {
      setSwapping(false);
    }
  }

  function onPointerCancel() {
    gesture.current = null;
    if (drag) settleBack();
  }

  function chipStyle(i: number): React.CSSProperties | undefined {
    if (!drag) return undefined;
    const { rects } = drag;
    const distance = (a: number, b: number) => (rects[a] && rects[b] ? rects[a].top - rects[b].top : 0);

    if (i === drag.from) {
      const carrying = drag.phase === 'carry';
      const y = carrying ? drag.dy : drag.over != null ? distance(drag.over, drag.from) : 0;
      return {
        transform: `translateY(${y}px)${carrying ? ' scale(1.03)' : ''}`,
        transition: carrying ? 'none' : `transform ${SETTLE_MS}ms ${EASE_DRAWER}`,
        zIndex: 2,
      };
    }
    if (i === drag.over) {
      return {
        transform: `translateY(${distance(drag.from, i)}px)`,
        transition: `transform 200ms ${EASE_OUT}`,
      };
    }
    return { transform: 'translateY(0)', transition: `transform 200ms ${EASE_OUT}` };
  }

  return (
    <Sheet onClose={onClose} dismissRef={sheet}>
      <h2>Rearrange days</h2>
      <p className="muted">Drag a session onto another day to swap them.</p>

      <div className="gd-rearrange-list" ref={listRef}>
        {week.map((day, i) => {
          const { name, date, isToday } = weekdayLabel(day.date);
          const { icon, label } = rowSummary(day);
          const carried = drag?.from === i && drag.phase === 'carry';
          return (
            <div
              key={day.id}
              data-row-index={i}
              className={`gd-rearrange-row${drag?.over === i ? ' gd-drop-target' : ''}`}
            >
              <div className="gd-rearrange-info">
                <span className="gd-rearrange-day">
                  {name}
                  {isToday ? ' · Today' : ''}
                </span>
                <span className="gd-rearrange-date">{date}</span>
              </div>
              <div
                className={`gd-rearrange-chip${carried ? ' gd-lifted' : ''}`}
                style={chipStyle(i)}
                data-sheet-no-drag
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <Icon name={icon} />
                <span className="gd-rearrange-summary">{label}</span>
                {day.manualOverride && (
                  <span className="gd-rearrange-pin" title="Manually rearranged">
                    <Icon name="pin" />
                  </span>
                )}
                <svg className="gd-rearrange-grip" viewBox="0 0 10 16" aria-hidden="true">
                  <circle cx="3" cy="3" r="1.3" />
                  <circle cx="7" cy="3" r="1.3" />
                  <circle cx="3" cy="8" r="1.3" />
                  <circle cx="7" cy="8" r="1.3" />
                  <circle cx="3" cy="13" r="1.3" />
                  <circle cx="7" cy="13" r="1.3" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="alert">{error}</div>}

      {hasOverrides && (
        <button type="button" className="gd-why-btn" onClick={revert} disabled={reverting || swapping}>
          {reverting ? 'Reverting…' : 'Revert to original plan'}
        </button>
      )}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => sheet.current?.()}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
