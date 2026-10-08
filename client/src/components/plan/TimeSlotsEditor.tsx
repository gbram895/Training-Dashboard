import type { TimeWindow } from '../../api/types';

// The day the timeline draws, local time. Anything outside it still saves;
// it just runs off the end of the bar.
const DAY_START = 5 * 60;
const DAY_END = 23 * 60;

export const MAX_SLOTS = 4;

const PRESETS: { label: string; slot: TimeWindow }[] = [
  { label: 'Morning', slot: { start: '06:00', end: '08:00' } },
  { label: 'Lunch', slot: { start: '12:00', end: '13:30' } },
  { label: 'Evening', slot: { start: '18:00', end: '21:00' } },
];

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function hhmm(total: number): string {
  const t = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function slotIsValid(slot: TimeWindow): boolean {
  return /^\d{2}:\d{2}$/.test(slot.start) && /^\d{2}:\d{2}$/.test(slot.end) && slot.start < slot.end;
}

function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The times in one day the athlete can train: a bar of the day with each slot
 * drawn on it, a row per slot with its own from/until pickers (the phone's
 * native time wheel), and one-tap Morning/Lunch/Evening to add the usual ones.
 * No slots means "any time".
 */
export default function TimeSlotsEditor({
  dayLabel,
  slots,
  onChange,
  onCopyToOthers,
}: {
  dayLabel: string;
  slots: TimeWindow[];
  onChange: (slots: TimeWindow[]) => void;
  /** Offered once the day has a slot: put the same slots on every other training day. */
  onCopyToOthers?: () => void;
}) {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));

  function update(index: number, slot: TimeWindow) {
    onChange(slots.map((s, i) => (i === index ? slot : s)));
  }

  // Kept in time order as slots are added; not while one is being edited,
  // or its row would jump away mid-change.
  function add(slot: TimeWindow) {
    onChange([...slots, slot].sort((a, b) => a.start.localeCompare(b.start)));
  }

  /** A sensible next slot: an hour after the last one ends, or the evening. */
  function addCustom() {
    const last = sorted.at(-1);
    const start = last ? Math.min(minutes(last.end) + 60, 22 * 60) : 18 * 60;
    add({ start: hhmm(start), end: hhmm(Math.min(start + 60, 23 * 60 + 59)) });
  }

  const span = DAY_END - DAY_START;

  return (
    <div className="gd-slots">
      <div className="gd-slots-bar" aria-hidden="true">
        {sorted.filter(slotIsValid).map((s, i) => {
          const from = Math.max(minutes(s.start), DAY_START);
          const to = Math.min(minutes(s.end), DAY_END);
          if (to <= from) return null;
          return (
            <span
              key={i}
              className="gd-slots-fill"
              style={{ left: `${((from - DAY_START) / span) * 100}%`, width: `${((to - from) / span) * 100}%` }}
            />
          );
        })}
        {[6, 12, 18].map((h) => (
          <span key={h} className="gd-slots-tick" style={{ left: `${((h * 60 - DAY_START) / span) * 100}%` }}>
            {h}
          </span>
        ))}
      </div>

      {slots.length === 0 && <p className="gd-slots-any">Any time of day</p>}

      {slots.map((slot, i) => {
        const clash = slots.some((other, j) => j !== i && slotIsValid(other) && slotIsValid(slot) && overlaps(slot, other));
        return (
          <div className={`gd-slot${slotIsValid(slot) ? '' : ' gd-slot-bad'}`} key={i}>
            <input
              type="time"
              step={900}
              value={slot.start}
              aria-label={`${dayLabel} slot ${i + 1} from`}
              onChange={(e) => update(i, { ...slot, start: e.target.value })}
            />
            <span className="gd-slot-dash">–</span>
            <input
              type="time"
              step={900}
              value={slot.end}
              aria-label={`${dayLabel} slot ${i + 1} until`}
              onChange={(e) => update(i, { ...slot, end: e.target.value })}
            />
            <button
              type="button"
              className="gd-slot-remove"
              aria-label={`Remove ${dayLabel} slot ${i + 1}`}
              onClick={() => onChange(slots.filter((_, j) => j !== i))}
            >
              ×
            </button>
            {!slotIsValid(slot) && <span className="gd-slot-note">Ends before it starts</span>}
            {slotIsValid(slot) && clash && <span className="gd-slot-note gd-slot-note-soft">Overlaps another slot</span>}
          </div>
        );
      })}

      <div className="gd-slots-add">
        {slots.length < MAX_SLOTS &&
          PRESETS.filter((p) => !slots.some((s) => slotIsValid(s) && overlaps(s, p.slot))).map((p) => (
            <button type="button" key={p.label} className="gd-slot-chip" onClick={() => add(p.slot)}>
              + {p.label}
            </button>
          ))}
        {slots.length < MAX_SLOTS && (
          <button type="button" className="gd-slot-chip" onClick={addCustom}>
            + Other time
          </button>
        )}
        {onCopyToOthers && slots.length > 0 && (
          <button type="button" className="gd-no-time-btn gd-slots-copy" onClick={onCopyToOthers}>
            Copy to other days
          </button>
        )}
      </div>
    </div>
  );
}
