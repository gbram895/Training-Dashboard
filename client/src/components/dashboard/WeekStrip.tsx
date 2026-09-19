import type { PlannedDay, Workout } from '../../api/types';
import { dateKey, mondayOf } from '../../lib/week';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

type DayStatus = 'done' | 'rest' | 'today' | 'planned';

export default function WeekStrip({ planWeek, recentWorkouts }: { planWeek: PlannedDay[]; recentWorkouts: Workout[] }) {
  const monday = mondayOf(new Date());
  const todayKey = dateKey(new Date());

  const workoutDates = new Set(recentWorkouts.map((w) => dateKey(new Date(w.date))));
  const plannedByDate = new Map(planWeek.map((d) => [dateKey(new Date(d.date)), d]));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dateKey(d);
    const planned = plannedByDate.get(key);

    let status: DayStatus;
    if (key === todayKey) status = 'today';
    else if (workoutDates.has(key)) status = 'done';
    else if (planned?.isRestDay) status = 'rest';
    else if (planned) status = 'planned';
    else status = 'rest';

    return { label: DAY_LABELS[i], status };
  });

  return (
    <div className="gd-week-strip">
      {days.map((day, i) => (
        <div key={i} className={`gd-day ${day.status}`}>
          <span className="gd-d-label">{day.label}</span>
          <span className="gd-d-dot">{day.status === 'done' ? CHECK : null}</span>
        </div>
      ))}
    </div>
  );
}
