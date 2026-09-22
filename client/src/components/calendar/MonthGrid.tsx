import type { CalendarDay } from '../../api/types';
import { dayLabel, dayStatus, monthGrid, TYPE_COLOR, WEEKDAY_INITIALS } from '../../lib/calendarData';

/**
 * A month, with the plan and the sessions actually trained on the same grid.
 *
 * Each cell says at a glance which of the two happened: a filled dot per
 * workout done (in that discipline's colour), a hollow ring for a session
 * still only planned, a dash for a rest day. The cell's own tint carries
 * whether the day was hit, missed or is still ahead.
 */
export default function MonthGrid({
  year,
  month,
  byDay,
  todayKey,
  planHorizon,
  weeklyHours,
  selected,
  onSelect,
}: {
  year: number;
  month: number;
  byDay: Map<string, CalendarDay>;
  todayKey: string;
  planHorizon: string;
  weeklyHours: number[] | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const weeks = monthGrid(year, month);

  return (
    <div className="gd-cal-month">
      <div className="gd-cal-weekdays">
        {WEEKDAY_INITIALS.map((initial, i) => (
          <span key={i}>{initial}</span>
        ))}
      </div>

      {weeks.map((week, i) => (
        <div className="gd-cal-week" key={i}>
          {week.map((cell) => {
            const day = byDay.get(cell.key);
            const status = dayStatus(cell.key, day, todayKey, planHorizon, weeklyHours);
            const done = day?.done ?? [];
            const planned = day?.planned;
            const goal = day?.goals?.[0];
            const classes = [
              'gd-cal-cell',
              `gd-cal-${status}`,
              cell.inMonth ? '' : 'gd-cal-outside',
              cell.key === todayKey ? 'gd-cal-today' : '',
              cell.key === selected ? 'gd-cal-picked' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                type="button"
                key={cell.key}
                className={classes}
                onClick={() => onSelect(cell.key === selected ? null : cell.key)}
                aria-label={dayLabel(cell.key, status)}
                data-day={cell.key}
              >
                <span className="gd-cal-num">{cell.date.getUTCDate()}</span>

                <span className="gd-cal-marks">
                  {/* Up to three, so a busy day doesn't stretch the row. */}
                  {done.slice(0, 3).map((workout) => (
                    <i key={workout.id} className="gd-cal-dot" style={{ background: TYPE_COLOR[workout.type] }} />
                  ))}
                  {done.length === 0 && planned && !planned.isRestDay && (
                    <i
                      className="gd-cal-ring"
                      style={{
                        borderColor: planned.discipline === 'RUN' ? 'var(--chart-run)' : 'var(--chart-ride)',
                      }}
                    />
                  )}
                  {done.length === 0 && planned?.isRestDay && <i className="gd-cal-dash" />}
                  {done.length === 0 && !planned && status === 'expected' && <i className="gd-cal-ghost" />}
                </span>

                {goal && <span className={`gd-cal-goal gd-priority-${goal.priority.toLowerCase()}`}>{goal.priority}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
