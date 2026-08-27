import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyHealthSummary } from '../../api/types';
import { mondayOf, dateKey } from '../../lib/week';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function HrvWeekCompareChart({ days }: { days: DailyHealthSummary[] }) {
  const byDate = new Map(days.map((d) => [dateKey(new Date(d.date)), d.avgHrv ?? null]));
  const thisMonday = mondayOf(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  const data = WEEKDAY_LABELS.map((label, i) => {
    const thisDate = new Date(thisMonday);
    thisDate.setUTCDate(thisDate.getUTCDate() + i);
    const lastDate = new Date(lastMonday);
    lastDate.setUTCDate(lastDate.getUTCDate() + i);
    return {
      day: label,
      thisWeek: byDate.get(dateKey(thisDate)) ?? null,
      lastWeek: byDate.get(dateKey(lastDate)) ?? null,
    };
  });

  const hasData = data.some((d) => d.thisWeek != null || d.lastWeek != null);

  return (
    <section className="card">
      <h2>HRV: this week vs last week</h2>
      {!hasData ? (
        <p className="muted">Not enough data yet.</p>
      ) : (
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
              <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} />
              <YAxis stroke="var(--text-faint)" fontSize={11} unit=" ms" />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
                formatter={(value, name) => [
                  value == null ? '—' : `${Number(value).toFixed(0)} ms`,
                  name === 'thisWeek' ? 'This week' : 'Last week',
                ]}
              />
              <Bar dataKey="lastWeek" fill="var(--grid-line)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="thisWeek" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
