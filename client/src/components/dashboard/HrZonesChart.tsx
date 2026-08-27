import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HrZoneWeek } from '../../api/types';
import { formatDateUTC } from '../../lib/format';

const ZONES: { key: keyof Omit<HrZoneWeek, 'weekStart'>; label: string; color: string }[] = [
  { key: 'z1', label: 'Z1 · Recovery', color: 'var(--chart-z1)' },
  { key: 'z2', label: 'Z2 · Endurance', color: 'var(--chart-z2)' },
  { key: 'z3', label: 'Z3 · Tempo', color: 'var(--chart-z3)' },
  { key: 'z4', label: 'Z4 · Threshold', color: 'var(--chart-z4)' },
  { key: 'z5', label: 'Z5 · Max', color: 'var(--chart-z5)' },
];

export default function HrZonesChart({ weeks }: { weeks: HrZoneWeek[] }) {
  const data = weeks.map((w) => ({ week: formatDateUTC(w.weekStart), ...w }));
  const hasData = data.some((d) => d.z1 + d.z2 + d.z3 + d.z4 + d.z5 > 0);

  return (
    <section className="card">
      <h2>Weekly time in HR zones (minutes)</h2>
      {!hasData ? (
        <p className="muted">
          No zone data yet — this needs heart-rate samples from synced Apple Health workouts.
        </p>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
              <XAxis dataKey="week" stroke="var(--text-faint)" fontSize={11} />
              <YAxis stroke="var(--text-faint)" fontSize={11} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                formatter={(value, _name, item) => [
                  `${Number(value).toFixed(0)} min`,
                  ZONES.find((z) => z.key === item.dataKey)?.label ?? String(item.dataKey),
                ]}
              />
              <Legend formatter={(_value, entry) => ZONES.find((z) => z.color === entry.color)?.label} />
              {ZONES.map((z) => (
                <Bar key={z.key} dataKey={z.key} stackId="zones" fill={z.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
