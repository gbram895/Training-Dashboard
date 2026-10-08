import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { CalendarEventItem, CalendarMonth, CalendarMonthDay, PlannedDay } from '../../api/types';
import { formatDuration } from '../../lib/format';
import { todayKey } from '../../lib/planDates';
import CadenceLoader from '../CadenceLoader';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Monday-first, matching how the rest of the app buckets a week. */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// The same colours the session types have elsewhere in the app's charts, so a
// threshold day reads the same here as on the workout profile.
const CATEGORY_COLOR: Record<string, string> = {
  ENDURANCE: 'var(--chart-z2)',
  TEMPO: 'var(--chart-z3)',
  THRESHOLD: 'var(--chart-z4)',
  VO2MAX: 'var(--chart-z5)',
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function longDate(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** One line in a day's agenda: either one of the athlete's events or the planned session. */
type AgendaItem =
  | { kind: 'event'; sortKey: string; event: CalendarEventItem }
  | { kind: 'plan'; sortKey: string; day: PlannedDay };

function agendaFor(day: CalendarMonthDay): AgendaItem[] {
  const items: AgendaItem[] = day.events.map((event) => ({
    kind: 'event',
    // All-day first, then by start; an event that began on an earlier day
    // sorts as if it started at midnight.
    sortKey: event.allDay ? '0' : `1${event.start < `${day.date}T` ? day.date : event.start}`,
    event,
  }));
  if (day.planned) {
    items.push({
      kind: 'plan',
      // An untimed session goes after everything timed: "some time today".
      sortKey: day.planned.plannedStart ? `1${day.planned.plannedStart}` : '2',
      day: day.planned,
    });
  }
  return items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * The plan's week overview, expanded to a whole month: the planned sessions
 * and the athlete's own calendar on one grid. A cell carries only the day
 * number, the session (as an icon on its session type's colour) and a dot per
 * event — at 320px a column is ~40px wide and nothing more fits. Everything
 * else is in the day's agenda underneath, which opens on today.
 */
export default function MonthCalendar({
  refreshKey,
  onOpenCalendars,
  onPickPlanDay,
}: {
  /** Changes whenever the plan does, so the grid re-reads it. */
  refreshKey: string;
  onOpenCalendars: () => void;
  /** A day was picked; the Plan tab selects it below if it's in the week. */
  onPickPlanDay: (dateKey: string) => void;
}) {
  const today = todayKey();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(today);
  const [refreshing, setRefreshing] = useState(false);

  const key = monthKey(cursor.year, cursor.month);

  function load(fresh = false) {
    return apiFetch<CalendarMonth>(`/calendar/month?month=${key}${fresh ? '&fresh=1' : ''}`)
      .then((month) => {
        setData(month);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the calendar'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  function step(delta: number) {
    setCursor(({ year, month }) => {
      const m = month + delta;
      return { year: year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  function pick(dateKey: string) {
    setSelected(dateKey);
    onPickPlanDay(dateKey);
  }

  const shownData = data?.month === key ? data : null;
  const weeks = useMemo(() => {
    if (!shownData) return [];
    const rows: CalendarMonthDay[][] = [];
    for (let i = 0; i < shownData.days.length; i += 7) rows.push(shownData.days.slice(i, i + 7));
    return rows;
  }, [shownData]);

  const selectedDay = shownData?.days.find((d) => d.date === selected) ?? null;
  const lastPlanned = shownData?.days.filter((d) => d.planned).at(-1)?.date ?? null;

  return (
    <div className="gd-month">
      <div className="gd-month-nav">
        <button type="button" className="gd-month-step" onClick={() => step(-1)} aria-label="Previous month">
          ‹
        </button>
        <h3 className="gd-month-title">
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </h3>
        <button type="button" className="gd-month-step" onClick={() => step(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="gd-month-tools">
        {key !== today.slice(0, 7) && (
          <button
            type="button"
            className="gd-no-time-btn"
            onClick={() => {
              setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
              setSelected(today);
            }}
          >
            Today
          </button>
        )}
        <button type="button" className="gd-no-time-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="gd-no-time-btn" onClick={onOpenCalendars}>
          Calendars
        </button>
      </div>

      {shownData && !shownData.calendarConnected && (
        <button type="button" className="gd-month-connect" onClick={onOpenCalendars}>
          <span>📅</span>
          <span>
            <strong>Show your iPhone calendar here</strong>
            <br />
            The plan will fit your training around what's already in it.
          </span>
        </button>
      )}
      {shownData?.calendarError && (
        <p className="gd-month-error">
          Couldn't read your calendar just now: {shownData.calendarError}
        </p>
      )}

      {error ? (
        <p className="muted">{error}</p>
      ) : !shownData ? (
        <div className="gd-cadence-inline">
          <CadenceLoader />
        </div>
      ) : (
        <div className="gd-month-grid" role="grid">
          <div className="gd-month-row gd-month-weekdays" role="row">
            {WEEKDAY_INITIALS.map((initial, i) => (
              <span key={i} role="columnheader">
                {initial}
              </span>
            ))}
          </div>
          {weeks.map((week, i) => (
            <div className="gd-month-row" role="row" key={i}>
              {week.map((day) => {
                const inMonth = day.date.slice(0, 7) === key;
                const planned = day.planned;
                const training = planned && !planned.isRestDay;
                const dayEvents = day.events;
                const classes = [
                  'gd-month-cell',
                  inMonth ? '' : 'gd-month-outside',
                  day.date === today ? 'gd-month-today' : '',
                  day.date === selected ? 'gd-month-picked' : '',
                  day.date < today ? 'gd-month-past' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={day.date}
                    className={classes}
                    onClick={() => pick(day.date)}
                    aria-label={`${longDate(day.date)}${training ? `, ${planned!.name}` : ''}${
                      dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''
                    }`}
                  >
                    <span className="gd-month-num">{Number(day.date.slice(8, 10))}</span>
                    {training ? (
                      <span
                        className="gd-month-session"
                        style={{ background: CATEGORY_COLOR[planned!.category ?? ''] ?? 'var(--accent-wash)' }}
                      >
                        {planned!.discipline === 'RUN' ? '🏃' : '🚴'}
                      </span>
                    ) : planned?.isRestDay ? (
                      <span className="gd-month-rest">–</span>
                    ) : (
                      <span className="gd-month-session-empty" />
                    )}
                    <span className="gd-month-dots">
                      {dayEvents.slice(0, 3).map((e) => (
                        <i key={e.id} style={{ background: e.color ?? 'var(--text-faint)' }} />
                      ))}
                      {dayEvents.length > 3 && <b>+{dayEvents.length - 3}</b>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {selectedDay && (
        <div className="gd-month-agenda">
          <h4>{selectedDay.date === today ? `Today · ${longDate(selectedDay.date)}` : longDate(selectedDay.date)}</h4>
          {agendaFor(selectedDay).map((item) =>
            item.kind === 'event' ? (
              <div className="gd-agenda-row" key={item.event.id}>
                <span className="gd-agenda-time">
                  {item.event.allDay ? 'All day' : `${clock(item.event.start)}–${clock(item.event.end)}`}
                </span>
                <span className="gd-agenda-bar" style={{ background: item.event.color ?? 'var(--text-faint)' }} />
                <span className="gd-agenda-what">
                  {item.event.title}
                  <small>
                    {item.event.calendar}
                    {item.event.location ? ` · ${item.event.location}` : ''}
                    {!item.event.busy ? ' · shown as free' : ''}
                  </small>
                </span>
              </div>
            ) : (
              <div className="gd-agenda-row gd-agenda-plan" key="plan">
                <span className="gd-agenda-time">
                  {item.day.isRestDay ? 'Rest' : item.day.plannedStart ? clock(item.day.plannedStart) : 'Any time'}
                </span>
                <span
                  className="gd-agenda-bar"
                  style={{ background: CATEGORY_COLOR[item.day.category ?? ''] ?? 'var(--accent-solid)' }}
                />
                <span className="gd-agenda-what">
                  {item.day.isRestDay ? (
                    <>
                      Rest day
                      <small>{item.day.restReason}</small>
                    </>
                  ) : (
                    <>
                      {item.day.discipline === 'RUN' ? '🏃' : '🚴'} {item.day.name}
                      <small>
                        {item.day.durationMin != null ? formatDuration(item.day.durationMin) : ''}
                        {item.day.category ? ` · ${item.day.category.toLowerCase()}` : ''}
                      </small>
                    </>
                  )}
                </span>
              </div>
            ),
          )}
          {!selectedDay.planned && selectedDay.events.length === 0 && (
            <p className="gd-agenda-empty">Nothing on this day.</p>
          )}
          {!selectedDay.planned && selectedDay.date > today && (!lastPlanned || selectedDay.date > lastPlanned) && (
            <p className="gd-agenda-empty">
              The plan is built two weeks ahead, so this day gets its session nearer the time.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
