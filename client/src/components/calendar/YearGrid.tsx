import type { CalendarDay } from '../../api/types';
import { dayStatus, doneMinutes, doneTss, monthGrid, MONTH_NAMES } from '../../lib/calendarData';

/**
 * How hard a day was, in five steps. Load (TSS) is the honest measure and most
 * days have it; a session that never got one — strength work with no heart
 * rate, say — falls back to how long it lasted so it still shows up.
 */
function heatLevel(day: CalendarDay | undefined): number {
  const tss = doneTss(day);
  if (tss > 0) {
    if (tss < 40) return 1;
    if (tss < 80) return 2;
    if (tss < 130) return 3;
    return 4;
  }
  const minutes = doneMinutes(day);
  if (minutes === 0) return 0;
  if (minutes < 45) return 1;
  if (minutes < 75) return 2;
  if (minutes < 120) return 3;
  return 4;
}

/**
 * The whole year on one screen: one small square per day, shaded by how much
 * training it actually carried, with the days still ahead drawn as outlines so
 * the plan and the past read as one continuous year rather than two charts.
 * Tapping a month opens it.
 */
export default function YearGrid({
  year,
  byDay,
  todayKey,
  planHorizon,
  weeklyHours,
  onOpenMonth,
}: {
  year: number;
  byDay: Map<string, CalendarDay>;
  todayKey: string;
  planHorizon: string;
  weeklyHours: number[] | null;
  onOpenMonth: (month: number) => void;
}) {
  return (
    <div className="gd-cal-year">
      {MONTH_NAMES.map((name, month) => {
        const weeks = monthGrid(year, month);
        return (
          <button type="button" className="gd-cal-mini" key={name} onClick={() => onOpenMonth(month)}>
            <span className="gd-cal-mini-name">{name.slice(0, 3)}</span>
            <span className="gd-cal-mini-grid">
              {weeks.map((week, i) =>
                week.map((cell) => {
                  if (!cell.inMonth) return <i className="gd-cal-mini-day gd-cal-mini-blank" key={cell.key + i} />;
                  const day = byDay.get(cell.key);
                  const status = dayStatus(cell.key, day, todayKey, planHorizon, weeklyHours);
                  const level = heatLevel(day);
                  const classes = [
                    'gd-cal-mini-day',
                    `gd-heat-${level}`,
                    status === 'planned' || status === 'expected' ? 'gd-cal-mini-planned' : '',
                    status === 'missed' ? 'gd-cal-mini-missed' : '',
                    day?.goals?.length ? 'gd-cal-mini-goal' : '',
                    cell.key === todayKey ? 'gd-cal-mini-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return <i className={classes} key={cell.key} title={cell.key} />;
                }),
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
