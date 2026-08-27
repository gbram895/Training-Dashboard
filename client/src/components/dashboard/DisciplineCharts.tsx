import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DisciplineStats } from '../../api/types';
import { formatDateUTC } from '../../lib/format';

const DISCIPLINES: { key: 'RUN' | 'RIDE' | 'SWIM'; label: string; color: string }[] = [
  { key: 'RUN', label: 'Run', color: 'var(--chart-run)' },
  { key: 'RIDE', label: 'Ride', color: 'var(--chart-ride)' },
  { key: 'SWIM', label: 'Swim', color: 'var(--chart-swim)' },
];

export default function DisciplineCharts({ weekly }: { weekly: DisciplineStats['weekly'] }) {
  const hasData = weekly.some((w) => w.RUN.durationMin + w.RIDE.durationMin + w.SWIM.durationMin > 0);

  const timeData = weekly.map((w) => ({
    week: formatDateUTC(w.weekStart),
    RUN: w.RUN.durationMin,
    RIDE: w.RIDE.durationMin,
    SWIM: w.SWIM.durationMin,
  }));
  const distanceData = weekly.map((w) => ({
    week: formatDateUTC(w.weekStart),
    RUN: w.RUN.distanceKm,
    RIDE: w.RIDE.distanceKm,
    SWIM: w.SWIM.distanceKm,
  }));

  if (!hasData) {
    return (
      <section className="card">
        <h2>Weekly training by discipline</h2>
        <p className="muted">No run/ride/swim workouts logged in the last 8 weeks yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h2>Weekly time by discipline (minutes)</h2>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={timeData} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
              <XAxis dataKey="week" stroke="var(--text-faint)" fontSize={11} />
              <YAxis stroke="var(--text-faint)" fontSize={11} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              />
              <Legend />
              {DISCIPLINES.map((d) => (
                <Bar key={d.key} dataKey={d.key} name={d.label} stackId="discipline" fill={d.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card">
        <h2>Weekly distance by discipline (km)</h2>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={distanceData} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
              <XAxis dataKey="week" stroke="var(--text-faint)" fontSize={11} />
              <YAxis stroke="var(--text-faint)" fontSize={11} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                formatter={(value) => Number(value).toFixed(1)}
              />
              <Legend />
              {DISCIPLINES.map((d) => (
                <Bar key={d.key} dataKey={d.key} name={d.label} stackId="discipline" fill={d.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
