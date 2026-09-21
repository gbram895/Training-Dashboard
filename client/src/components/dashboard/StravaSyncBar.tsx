import { useEffect, useState } from 'react';
import { apiFetch, getToken } from '../../api/client';
import type { StravaSyncStatus, SyncNowResult } from '../../api/types';
import { describeSyncResult } from '../../lib/syncResult';

export default function StravaSyncBar({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<StravaSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  function reload() {
    apiFetch<StravaSyncStatus>('/health/strava/status').then(setStatus);
  }

  useEffect(reload, []);

  async function syncNow(force = false) {
    setSyncing(true);
    setSyncNote(null);
    try {
      // Awaited for a plain sync, so this resolves with what actually landed
      // rather than with "started" before any work had been done.
      const result = await apiFetch<SyncNowResult>(`/health/strava/sync-now${force ? '?force=true' : ''}`, {
        method: 'POST',
      });
      setSyncNote(describeSyncResult(result));
      setTimeout(() => setSyncNote(null), 8000);
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
      reload();
      onSynced?.();
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
        {status.lastSyncError ? ` — ${status.lastSyncError}` : ''}
        {syncNote ? ` — ${syncNote}` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={() => syncNow(true)} disabled={syncing}>
          Backfill all history
        </button>
        <button type="button" className="secondary" onClick={() => syncNow(false)} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" className="secondary" onClick={disconnect} disabled={syncing}>
          Disconnect
        </button>
      </div>
    </section>
  );
}
