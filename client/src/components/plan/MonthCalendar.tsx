import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type {
  CalendarDoneWorkout,
  CalendarEventItem,
  CalendarMonth,
  CalendarMonthDay,
  PlannedDay,
} from '../../api/types';
import { formatDuration } from '../../lib/format';
import { TYPE_ICON, TYPE_LABEL } from '../../lib/workoutTypes';
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
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1:45", the way a training calendar writes a session's length. */
function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
}

/** ISO week number, which is what a training calendar labels its rows with. */
function isoWeek(key: string): number {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** What a day's card shows: what was done, up to today, and what is planned from today on. */
function cardsFor(day: CalendarMonthDay, today: string): { done: CalendarDoneWorkout[]; planned: PlannedDay | null } {
  const done = day.date <= today ? day.done : [];
  const showPlan = day.planned && !day.planned.isRestDay && day.date >= today && done.length === 0;
  return { done, planned: showPlan ? day.planned : null };
}

interface WeekSummary {
  week: number;
  minutes: number;
  load: number;
  fitness: { ctl: number; atl: number; tsb: number } | null;
}

/**
 * A week's totals the way a training calendar's side column gives them: time
 * and load counted from what was done up to today and what is planned after,
 * and Fitness, Fatigue and Form as they stand at the end of the week (or as
 * far as the plan reaches).
 */
function summarize(week: CalendarMonthDay[], today: string): WeekSummary {
  let minutes = 0;
  let load = 0;
  for (const day of week) {
    const { done, planned } = cardsFor(day, today);
    for (const w of done) {
      minutes += w.durationMin;
      load += w.load ?? 0;
    }
    if (planned) {
      minutes += planned.durationMin ?? 0;
      load += day.plannedLoad ?? 0;
    }
  }
  const fitness = [...week].reverse().find((d) => d.fitness)?.fitness ?? null;
  return {
    week: isoWeek(week[0].date),
    minutes,
    load: Math.round(load),
    fitness,
  };
}

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
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
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
  | { kind: 'plan'; sortKey: string; day: PlannedDay }
  | { kind: 'done'; sortKey: string; workout: CalendarDoneWorkout };

function agendaFor(day: CalendarMonthDay, today: string): AgendaItem[] {
  const items: AgendaItem[] = day.events.map((event) => ({
    kind: 'event',
    // All-day first, then by start; an event that began on an earlier day
    // sorts as if it started at midnight.
    sortKey: event.allDay ? '0' : `1${event.start < `${day.date}T` ? day.date : event.start}`,
    event,
  }));
  for (const workout of day.done) items.push({ kind: 'done', sortKey: '3', workout });
  if (day.planned && !(day.done.length > 0 && day.date <= today)) {
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
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
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
              setCursor({
                year: Number(today.slice(0, 4)),
                month: Number(today.slice(5, 7)) - 1,
              });
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
        <p className="gd-month-error">Couldn't read your calendar just now: {shownData.calendarError}</p>
      )}

      {error ? (
        <p className="muted">{error}</p>
      ) : !shownData ? (
        <div className="gd-cadence-inline">
          <CadenceLoader />
        </div>
      ) : (
        <div className="gd-month-grid" role="grid">
          <div className="gd-month-head" role="row">
            <span className="gd-month-weekcol" role="columnheader">
              Week
            </span>
            {WEEKDAYS.map((name) => (
              <span key={name} role="columnheader">
                {name}
              </span>
            ))}
          </div>
          {weeks.map((week) => {
            const sum = summarize(week, today);
            const isCurrent = week.some((d) => d.date === today);
            return (
              <div className={`gd-month-week${isCurrent ? ' gd-month-week-now' : ''}`} role="row" key={week[0].date}>
                <div className="gd-week-sum">
                  <span className="gd-week-no">W{sum.week}</span>
                  {(sum.minutes > 0 || sum.fitness) && <span className="gd-week-time">{hm(sum.minutes)}</span>}
                  {(sum.minutes > 0 || sum.fitness) && (
                    <dl>
                      <div>
                        <dt>Load</dt>
                        <dd>{sum.load}</dd>
                      </div>
                      {sum.fitness && (
                        <>
                          <div>
                            <dt>Fitness</dt>
                            <dd>{Math.round(sum.fitness.ctl)}</dd>
                          </div>
                          <div>
                            <dt>Fatigue</dt>
                            <dd>{Math.round(sum.fitness.atl)}</dd>
                          </div>
                          <div>
                            <dt>Form</dt>
                            <dd
                              className={
                                sum.fitness.tsb > 5 ? 'gd-form-fresh' : sum.fitness.tsb < -20 ? 'gd-form-deep' : ''
                              }
                            >
                              {Math.round(sum.fitness.tsb)}
                            </dd>
                          </div>
                        </>
                      )}
                    </dl>
                  )}
                </div>
                {week.map((day) => {
                  const inMonth = day.date.slice(0, 7) === key;
                  const { done, planned } = cardsFor(day, today);
                  const restDay = day.planned?.isRestDay && day.date >= today && done.length === 0;
                  const dayNum = Number(day.date.slice(8, 10));
                  const classes = [
                    'gd-month-cell',
                    inMonth ? '' : 'gd-month-outside',
                    day.date === today ? 'gd-month-today' : '',
                    day.date === selected ? 'gd-month-picked' : '',
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
                      aria-label={`${longDate(day.date)}${planned ? `, ${planned.name}` : ''}${
                        done.length ? `, ${done.length} done` : ''
                      }${day.events.length ? `, ${day.events.length} event${day.events.length === 1 ? '' : 's'}` : ''}`}
                    >
                      <span className="gd-month-num">
                        {dayNum === 1 && <small>{MONTH_SHORT[Number(day.date.slice(5, 7)) - 1]} </small>}
                        <b>{dayNum}</b>
                      </span>
                      {done.map((w) => (
                        <span className="gd-day-card gd-day-card-done" key={w.id}>
                          <span className="gd-day-card-name">
                            <i>{TYPE_ICON[w.type]}</i>
                            <em>{w.title ?? TYPE_LABEL[w.type]}</em>
                          </span>
                          <span className="gd-day-card-meta">
                            {hm(w.durationMin)}
                            {w.load != null && <span className="gd-day-card-load"> · {w.load}</span>}
                          </span>
                        </span>
                      ))}
                      {planned && (
                        <span
                          className="gd-day-card gd-day-card-plan"
                          style={{
                            borderLeftColor: CATEGORY_COLOR[planned.category ?? ''] ?? 'var(--accent-a)',
                          }}
                        >
                          <span className="gd-day-card-name">
                            <i>{planned.discipline === 'RUN' ? '🏃' : '🚴'}</i>
                            <em>{planned.name}</em>
                          </span>
                          <span className="gd-day-card-meta">
                            {planned.durationMin != null ? hm(planned.durationMin) : ''}
                            {day.plannedLoad != null && <span className="gd-day-card-load"> · {day.plannedLoad}</span>}
                          </span>
                        </span>
                      )}
                      {restDay && <span className="gd-month-rest">Rest</span>}
                      {day.events.length > 0 && (
                        <span className="gd-month-events">
                          {day.events.slice(0, 2).map((e) => (
                            <span key={e.id} className="gd-month-event">
                              <i
                                style={{
                                  background: e.color ?? 'var(--text-faint)',
                                }}
                              />
                              <em>
                                {e.allDay ? '' : `${clock(e.start)} `}
                                {e.title}
                              </em>
                            </span>
                          ))}
                          {day.events.length > 2 && <b>+{day.events.length - 2}</b>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {selectedDay && (
        <div className="gd-month-agenda">
          <h4>{selectedDay.date === today ? `Today · ${longDate(selectedDay.date)}` : longDate(selectedDay.date)}</h4>
          {agendaFor(selectedDay, today).map((item) =>
            item.kind === 'done' ? (
              <div className="gd-agenda-row gd-agenda-done" key={item.workout.id}>
                <span className="gd-agenda-time">Done</span>
                <span className="gd-agenda-bar" style={{ background: 'var(--text-faint)' }} />
                <span className="gd-agenda-what">
                  {TYPE_ICON[item.workout.type]} {item.workout.title ?? TYPE_LABEL[item.workout.type]}
                  <small>
                    {hm(item.workout.durationMin)}
                    {item.workout.load != null ? ` · load ${item.workout.load}` : ''}
                  </small>
                </span>
              </div>
            ) : item.kind === 'event' ? (
              <div className="gd-agenda-row" key={item.event.id}>
                <span className="gd-agenda-time">
                  {item.event.allDay ? 'All day' : `${clock(item.event.start)}–${clock(item.event.end)}`}
                </span>
                <span
                  className="gd-agenda-bar"
                  style={{
                    background: item.event.color ?? 'var(--text-faint)',
                  }}
                />
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
                  style={{
                    background: CATEGORY_COLOR[item.day.category ?? ''] ?? 'var(--accent-solid)',
                  }}
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
          {!selectedDay.planned && selectedDay.events.length === 0 && selectedDay.done.length === 0 && (
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
