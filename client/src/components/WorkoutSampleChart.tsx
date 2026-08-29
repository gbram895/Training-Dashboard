import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

function formatOffset(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WorkoutSampleChart({
  title,
  data,
  color,
  unit,
  formatValue,
}: {
  title: string;
  data: { offsetSec: number; value: number | null }[];
  color: string;
  unit: string;
  formatValue?: (value: number) => string;
}) {
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div>
      <h3 className="workout-profile-heading">{title}</h3>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis
              dataKey="offsetSec"
              tickFormatter={formatOffset}
              stroke="var(--text-faint)"
              fontSize={11}
              interval={tickInterval}
            />
            <YAxis stroke="var(--text-faint)" fontSize={11} domain={['auto', 'auto']} width={40} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelFormatter={(value) => formatOffset(Number(value))}
              formatter={(value) => [
                value == null ? '—' : formatValue ? formatValue(Number(value)) : `${value} ${unit}`,
                title,
              ]}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
