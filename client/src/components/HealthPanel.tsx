import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../api/client';
import type { DailyHealthSummary } from '../api/types';

function formatDay(date: string) {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'short' });
}

export default function HealthPanel() {
  const [days, setDays] = useState<DailyHealthSummary[] | null>(null);

  useEffect(() => {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
  }, []);

  if (days === null) return null;
  if (days.length === 0) return null;

  const latest = days[days.length - 1];
  const stepsData = days.map((d) => ({ day: formatDay(d.date), steps: d.steps ?? 0 }));
  const sleepData = days.map((d) => ({ day: formatDay(d.date), hours: d.sleepHours ?? 0 }));

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Health (Apple Health)</h2>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {new Date(latest.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="health-stat-grid">
        <div className="health-stat">
          <span className="stat-value">{latest.steps?.toLocaleString() ?? '—'}</span>
          <span className="stat-label">Steps</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latest.restingHeartRate?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">Resting HR</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latest.sleepHours?.toFixed(1) ?? '—'}h</span>
          <span className="stat-label">Sleep</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latest.activeEnergyKcal?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">Active kcal</span>
        </div>
      </div>

      <div className="health-charts">
        <div>
          <p className="muted health-chart-label">Steps</p>
          <div style={{ width: '100%', height: 90 }}>
            <ResponsiveContainer>
              <LineChart data={stepsData} margin={{ top: 4, left: -30, right: 8, bottom: 0 }}>
                <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={11} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
                <Line type="monotone" dataKey="steps" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p className="muted health-chart-label">Sleep (hours)</p>
          <div style={{ width: '100%', height: 90 }}>
            <ResponsiveContainer>
              <LineChart data={sleepData} margin={{ top: 4, left: -30, right: 8, bottom: 0 }}>
                <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={11} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
                <Line type="monotone" dataKey="hours" stroke="#47bfff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
