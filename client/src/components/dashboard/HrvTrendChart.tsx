import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyHealthSummary } from '../../api/types';
import { classifyHrv, HRV_STATUS_COLOR, rollingAverage, type HrvStatus } from '../../lib/hrv';
import { formatDateUTC } from '../../lib/format';

function HrvDot(props: { cx?: number; cy?: number; payload?: { hrv: number | null; status: HrvStatus | null } }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload || payload.hrv == null) return null;
  const color = payload.status ? HRV_STATUS_COLOR[payload.status] : 'var(--chart-sleep)';
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface)" strokeWidth={1.5} />;
}

export default function HrvTrendChart({ days }: { days: DailyHealthSummary[] }) {
  const hrvSeries = days.map((d) => d.avgHrv ?? null);
  const rolling = rollingAverage(hrvSeries, 7);

  const data = days.map((d, i) => ({
    day: formatDateUTC(d.date),
    hrv: d.avgHrv ?? null,
    rollingAvg: rolling[i],
    status: d.avgHrv != null && rolling[i] != null ? classifyHrv(d.avgHrv, rolling[i]!) : null,
  }));

  const hasData = data.some((d) => d.hrv != null);
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>HRV trend — daily + 7-day rolling average</h2>
      </div>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: HRV_STATUS_COLOR.balanced }} /> Balanced
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: HRV_STATUS_COLOR.unbalanced }} /> Unbalanced
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: HRV_STATUS_COLOR.low }} /> Low
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-line" /> 7-day avg
        </span>
      </div>
      {!hasData ? (
        <p className="muted">Not enough HRV data yet.</p>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, left: 0, right: 24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
              <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} interval={tickInterval} />
              <YAxis stroke="var(--text-faint)" fontSize={11} domain={['auto', 'auto']} unit=" ms" />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
                formatter={(value, name) => [
                  value == null ? '—' : `${Number(value).toFixed(0)} ms`,
                  name === 'rollingAvg' ? '7-day avg' : 'Daily HRV',
                ]}
              />
              <Area type="monotone" dataKey="hrv" stroke="none" fill="var(--chart-sleep)" fillOpacity={0.08} />
              <Line
                type="monotone"
                dataKey="hrv"
                stroke="var(--chart-sleep)"
                strokeWidth={2}
                dot={<HrvDot />}
                activeDot={{ r: 5 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="rollingAvg"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
