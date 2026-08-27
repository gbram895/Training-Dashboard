import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyHealthSummary } from '../../api/types';
import { formatDateUTC, formatDuration } from '../../lib/format';

export default function SleepRhrCharts({ days }: { days: DailyHealthSummary[] }) {
  const recent = days.slice(-14);
  const sleepData = recent.map((d) => ({ day: formatDateUTC(d.date), value: d.sleepHours ?? null }));
  const rhrData = recent.map((d) => ({ day: formatDateUTC(d.date), value: d.restingHeartRate ?? null }));
  const tickInterval = Math.max(0, Math.ceil(recent.length / 6) - 1);

  return (
    <section className="card">
      <h2>Sleep hours + resting HR</h2>
      <p className="muted health-chart-label">Sleep</p>
      <div style={{ width: '100%', height: 110 }}>
        <ResponsiveContainer>
          <BarChart data={sleepData} margin={{ top: 4, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} interval={tickInterval} />
            <YAxis stroke="var(--text-faint)" fontSize={11} unit="h" />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              formatter={(value) => [value == null ? '—' : formatDuration(Number(value) * 60), 'Sleep']}
            />
            <Bar dataKey="value" fill="var(--chart-hrv)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted health-chart-label">Resting heart rate</p>
      <div style={{ width: '100%', height: 110 }}>
        <ResponsiveContainer>
          <LineChart data={rhrData} margin={{ top: 4, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} interval={tickInterval} />
            <YAxis
              stroke="var(--text-faint)"
              fontSize={11}
              unit=" bpm"
              domain={['auto', 'auto']}
              tickCount={3}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              formatter={(value) => [value == null ? '—' : `${Number(value).toFixed(0)} bpm`, 'Resting HR']}
            />
            <Line type="monotone" dataKey="value" stroke="var(--chart-run)" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
