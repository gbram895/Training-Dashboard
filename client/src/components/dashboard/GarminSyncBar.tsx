import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { GarminSyncStatus } from '../../api/types';

export default function GarminSyncBar({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<GarminSyncStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);

  function reload() {
    apiFetch<GarminSyncStatus>('/health/garmin/status').then(setStatus);
  }

  useEffect(reload, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setConnectError(null);
    try {
      await apiFetch('/health/garmin/connect', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUsername('');
      setPassword('');
      reload();
      onSynced?.();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow(force = false) {
    setSyncing(true);
    try {
      await apiFetch(`/health/garmin/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      setSyncStarted(true);
      setTimeout(() => setSyncStarted(false), 8000);
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    await apiFetch('/health/garmin/disconnect', { method: 'POST' });
    reload();
  }

  if (status === null) return null;

  if (!status.connected) {
    return (
      <section className="card sync-bar">
        <form onSubmit={connect} className="garmin-connect-form">
          <p className="muted">Connect Garmin Connect to sync activities from your bike computer.</p>
          <input
            type="email"
            placeholder="Garmin Connect email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect Garmin'}
          </button>
        </form>
        {connectError && <div className="alert">{connectError}</div>}
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
