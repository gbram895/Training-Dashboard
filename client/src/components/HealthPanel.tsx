import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch, getToken } from '../api/client';
import type { DailyHealthSummary, DropboxSyncStatus } from '../api/types';
import { formatDuration } from '../lib/format';

function formatDay(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function latestValue(
  days: DailyHealthSummary[],
  key: keyof DailyHealthSummary,
): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i][key];
    if (typeof value === 'number') return value;
  }
  return null;
}

function HealthLineChart({
  label,
  data,
  dataKey,
  color,
  tooltipFormatter,
}: {
  label: string;
  data: { day: string; value: number }[];
  dataKey: 'value';
  color: string;
  tooltipFormatter?: (value: number) => string;
}) {
  const tickInterval = Math.max(0, Math.ceil(data.length / 6) - 1);

  if (data.length === 0) {
    return (
      <div>
        <p className="muted health-chart-label">{label}</p>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Not enough data yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="muted health-chart-label">{label}</p>
      <div style={{ width: '100%', height: 90 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, left: -30, right: 24, bottom: 0 }}>
            <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={11} interval={tickInterval} />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
              formatter={
                tooltipFormatter ? (value) => [tooltipFormatter(Number(value)), label] : undefined
              }
            />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function HealthPanel() {
  const [days, setDays] = useState<DailyHealthSummary[] | null>(null);
  const [status, setStatus] = useState<DropboxSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);

  function reload() {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
    apiFetch<DropboxSyncStatus>('/health/dropbox/status').then(setStatus);
  }

  useEffect(reload, []);

  async function syncNow(force = false) {
    setSyncing(true);
    try {
      await apiFetch(`/health/dropbox/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      setSyncStarted(true);
      setTimeout(() => setSyncStarted(false), 8000);
    } finally {
      setSyncing(false);
    }
  }

  if (days === null || status === null) return null;

  const hasData = days.length > 0;

  if (!hasData) {
    if (status.connected) {
      return (
        <section className="card">
          <h2>Health (Apple Health)</h2>
          <p className="muted">
            Dropbox is connected. Waiting for the first sync
            {status.lastSyncError ? ` — last attempt failed: ${status.lastSyncError}` : '…'}
          </p>
          <button type="button" onClick={() => syncNow(false)} disabled={syncing}>
            {syncing ? 'Starting…' : 'Sync now'}
          </button>
          {syncStarted && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Sync started in the background — this can take a few minutes for a large history.
            </p>
          )}
        </section>
      );
    }
    if (status.configured) {
      return (
        <section className="card">
          <h2>Health (Apple Health)</h2>
          <p className="muted">
            Connect Dropbox to automatically sync your Apple Health metrics (steps, heart rate,
            sleep, and more) into this dashboard.
          </p>
          <a href={`/api/health/dropbox/connect?token=${getToken()}`} style={{ textDecoration: 'none' }}>
            <button type="button">Connect Dropbox</button>
          </a>
        </section>
      );
    }
    return null;
  }

  const latest = days[days.length - 1];
  const stepsData = days.map((d) => ({ day: formatDay(d.date), value: d.steps ?? 0 }));
  const sleepData = days.map((d) => ({ day: formatDay(d.date), value: d.sleepHours ?? 0 }));
  const hrData = days
    .filter((d) => d.avgHeartRate != null)
    .map((d) => ({ day: formatDay(d.date), value: d.avgHeartRate! }));
  const hrvData = days
    .filter((d) => d.avgHrv != null)
    .map((d) => ({ day: formatDay(d.date), value: d.avgHrv! }));

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Health (Apple Health)</h2>
        {status.connected ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => syncNow(true)}
              disabled={syncing}
              title="Re-processes every synced file instead of only new ones"
            >
              {syncing ? 'Starting…' : 'Re-sync all'}
            </button>
            <button type="button" className="secondary" onClick={() => syncNow(false)} disabled={syncing}>
              {syncing ? 'Starting…' : syncStarted ? 'Started ✓' : 'Sync now'}
            </button>
          </div>
        ) : status.configured ? (
          <a href={`/api/health/dropbox/connect?token=${getToken()}`} style={{ textDecoration: 'none' }}>
            <button type="button" className="secondary">
              Connect Dropbox
            </button>
          </a>
        ) : null}
      </div>

      <div className="health-stat-grid">
        <div className="health-stat">
          <span className="stat-value">{latest.steps?.toLocaleString() ?? '—'}</span>
          <span className="stat-label">Steps</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latest.activeEnergyKcal?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">Active kcal</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">
            {latest.sleepHours != null ? formatDuration(latest.sleepHours * 60) : '—'}
          </span>
          <span className="stat-label">Sleep</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latestValue(days, 'restingHeartRate')?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">Resting HR</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latestValue(days, 'avgHeartRate')?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">Avg HR</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latestValue(days, 'avgHrv')?.toFixed(0) ?? '—'}</span>
          <span className="stat-label">HRV (ms)</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">
            {latestValue(days, 'avgBloodOxygen') != null
              ? `${latestValue(days, 'avgBloodOxygen')!.toFixed(0)}%`
              : '—'}
          </span>
          <span className="stat-label">Blood O₂</span>
        </div>
        <div className="health-stat">
          <span className="stat-value">{latestValue(days, 'vo2Max')?.toFixed(1) ?? '—'}</span>
          <span className="stat-label">VO2 Max</span>
        </div>
      </div>

      <div className="health-charts">
        <HealthLineChart label="Steps" data={stepsData} dataKey="value" color="var(--accent)" />
        <HealthLineChart
          label="Sleep (hours)"
          data={sleepData}
          dataKey="value"
          color="#47bfff"
          tooltipFormatter={(value) => formatDuration(value * 60)}
        />
        <HealthLineChart
          label="Heart rate (bpm)"
          data={hrData}
          dataKey="value"
          color="#ff6b6b"
          tooltipFormatter={(value) => `${value.toFixed(0)} bpm`}
        />
        <HealthLineChart
          label="HRV (ms)"
          data={hrvData}
          dataKey="value"
          color="#ffb84d"
          tooltipFormatter={(value) => `${value.toFixed(0)} ms`}
        />
      </div>
    </section>
  );
}
