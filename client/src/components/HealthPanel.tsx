import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch, getToken } from '../api/client';
import type { DailyHealthSummary, DropboxSyncStatus } from '../api/types';

function formatDay(date: string) {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'short' });
}

export default function HealthPanel() {
  const [days, setDays] = useState<DailyHealthSummary[] | null>(null);
  const [status, setStatus] = useState<DropboxSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  function reload() {
    apiFetch<DailyHealthSummary[]>('/health/summary').then(setDays);
    apiFetch<DropboxSyncStatus>('/health/dropbox/status').then(setStatus);
  }

  useEffect(reload, []);

  async function syncNow() {
    setSyncing(true);
    try {
      await apiFetch('/health/dropbox/sync-now', { method: 'POST' });
    } catch {
      // surfaced via lastSyncError after reload
    } finally {
      reload();
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
          <button type="button" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
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
  const stepsData = days.map((d) => ({ day: formatDay(d.date), steps: d.steps ?? 0 }));
  const sleepData = days.map((d) => ({ day: formatDay(d.date), hours: d.sleepHours ?? 0 }));

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Health (Apple Health)</h2>
        {status.connected ? (
          <button type="button" className="secondary" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
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
