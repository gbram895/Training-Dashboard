import { useEffect, useState } from 'react';
import { apiFetch, getToken } from '../../api/client';
import type { StravaSyncStatus } from '../../api/types';

export default function StravaSyncBar({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<StravaSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);

  function reload() {
    apiFetch<StravaSyncStatus>('/health/strava/status').then(setStatus);
  }

  useEffect(reload, []);

  async function syncNow(force = false) {
    setSyncing(true);
    try {
      await apiFetch(`/health/strava/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      setSyncStarted(true);
      setTimeout(() => setSyncStarted(false), 8000);
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    await apiFetch('/health/strava/disconnect', { method: 'POST' });
    reload();
  }

  if (status === null) return null;
  if (!status.connected && !status.configured) return null;

  if (!status.connected) {
    return (
      <section className="card sync-bar">
        <p className="muted">
          Connect Strava to sync activities — including ones Garmin already uploads there automatically.
        </p>
        <a href={`/api/health/strava/connect?token=${getToken()}`} style={{ textDecoration: 'none' }}>
          <button type="button">Connect Strava</button>
        </a>
      </section>
    );
  }

  return (
    <section className="card sync-bar">
      <p className="muted">
        {status.lastSyncedAt
          ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`
          : 'Waiting for first sync…'}
        {status.lastSyncError ? ` — last attempt failed: ${status.lastSyncError}` : ''}
        {syncStarted ? ' — sync started, this can take a few minutes' : ''}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={() => syncNow(true)} disabled={syncing}>
          Backfill all history
        </button>
        <button type="button" className="secondary" onClick={() => syncNow(false)} disabled={syncing}>
          {syncing ? 'Starting…' : 'Sync now'}
        </button>
        <button type="button" className="secondary" onClick={disconnect} disabled={syncing}>
          Disconnect
        </button>
      </div>
    </section>
  );
}
