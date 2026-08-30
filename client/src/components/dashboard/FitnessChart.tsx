import { useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../../api/client';
import type { FitnessPoint } from '../../api/types';
import { formatDateUTC } from '../../lib/format';

export default function FitnessChart({ series, onBackfilled }: { series: FitnessPoint[]; onBackfilled: () => void }) {
  const [backfilling, setBackfilling] = useState(false);

  async function backfill() {
    setBackfilling(true);
    try {
      await apiFetch('/workouts/backfill-training-load', { method: 'POST' });
      onBackfilled();
    } finally {
      setBackfilling(false);
    }
  }

  if (series.length === 0) {
    return (
      <section className="card">
        <div className="card-header-row">
          <h2>Fitness</h2>
        </div>
        <p className="muted">
          Not enough TSS data yet — this needs at least one ride or run that was synced (or logged) after this feature
          shipped. If you already have activities from before, backfill them below.
        </p>
        <button type="button" className="secondary" onClick={backfill} disabled={backfilling}>
          {backfilling ? 'Backfilling…' : 'Backfill from existing activities'}
        </button>
      </section>
    );
  }

  const today = series[series.length - 1];
  const tickInterval = Math.max(0, Math.ceil(series.length / 8) - 1);

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Fitness</h2>
        <button type="button" className="secondary" onClick={backfill} disabled={backfilling}>
          {backfilling ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>

      <div className="workout-stat-tiles" style={{ marginBottom: '0.75rem' }}>
        <div className="workout-stat">
          <span className="workout-stat-value" style={{ color: 'var(--chart-ride)' }}>
            {today.ctl}
          </span>
          <span className="workout-stat-label">Fitness (CTL)</span>
        </div>
        <div className="workout-stat">
          <span className="workout-stat-value" style={{ color: 'var(--chart-hrv)' }}>
            {today.atl}
          </span>
          <span className="workout-stat-label">Fatigue (ATL)</span>
        </div>
        <div className="workout-stat">
          <span
            className="workout-stat-value"
            style={{ color: today.tsb >= 0 ? 'var(--chart-swim)' : 'var(--chart-heart-rate)' }}
          >
            {today.tsb >= 0 ? '+' : ''}
            {today.tsb}
          </span>
          <span className="workout-stat-label">Form (TSB)</span>
        </div>
      </div>

      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-line" style={{ borderTopColor: 'var(--chart-ride)', borderTopStyle: 'solid' }} />{' '}
          Fitness (CTL)
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-line" style={{ borderTopColor: 'var(--chart-hrv)', borderTopStyle: 'solid' }} />{' '}
          Fatigue (ATL)
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: 'var(--chart-swim)' }} /> Form (TSB) — fresh
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: 'var(--chart-heart-rate)' }} /> Form (TSB) — fatigued
        </span>
      </div>

      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={series} margin={{ top: 8, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDateUTC(d)}
              stroke="var(--text-faint)"
              fontSize={11}
              interval={tickInterval}
            />
            <YAxis stroke="var(--text-faint)" fontSize={11} domain={['auto', 'auto']} width={40} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelFormatter={(d) => formatDateUTC(String(d), { month: 'long', day: 'numeric' })}
              formatter={(value, name) => [
                value,
                name === 'ctl' ? 'Fitness (CTL)' : name === 'atl' ? 'Fatigue (ATL)' : 'Form (TSB)',
              ]}
            />
            <Bar dataKey="tsb" maxBarSize={6} isAnimationActive={false}>
              {series.map((point, i) => (
                <Cell key={i} fill={point.tsb >= 0 ? 'var(--chart-swim)' : 'var(--chart-heart-rate)'} fillOpacity={0.5} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ctl" stroke="var(--chart-ride)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="atl" stroke="var(--chart-hrv)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
