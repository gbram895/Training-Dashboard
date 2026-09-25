import { useState } from 'react';
import { apiFetch, getToken } from '../../api/client';
import type { StravaSyncStatus, SyncNowResult } from '../../api/types';
import { describeSyncResult } from '../../lib/syncResult';
import SyncStatusBar from './SyncStatusBar';

export default function StravaSyncBar({
  status,
  onChanged,
}: {
  status: StravaSyncStatus | null;
  onChanged: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

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
    } catch {
      // Swallowed on purpose: the run recorded why it failed, and the refetch
      // below brings that back as the bar's own failure state.
    } finally {
      setSyncing(false);
      onChanged();
    }
  }

  async function disconnect() {
    await apiFetch('/health/strava/disconnect', { method: 'POST' });
    onChanged();
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
    <SyncStatusBar
      name="Strava"
      status={status}
      note={syncNote}
      syncing={syncing}
      onSyncNow={() => syncNow(false)}
      extraActions={
        <>
          <button type="button" className="secondary" onClick={() => syncNow(true)} disabled={syncing}>
            Backfill all history
          </button>
          <button type="button" className="secondary" onClick={disconnect} disabled={syncing}>
            Disconnect
          </button>
        </>
      }
    />
  );
}
