import { useEffect, useState } from 'react';
import { apiFetch, getToken } from '../../api/client';
import type { DropboxSyncStatus } from '../../api/types';

export default function DropboxSyncBar({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<DropboxSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);

  function reload() {
    apiFetch<DropboxSyncStatus>('/health/dropbox/status').then(setStatus);
  }

  useEffect(reload, []);

  async function syncNow(force = false) {
    setSyncing(true);
    try {
      await apiFetch(`/health/dropbox/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      setSyncStarted(true);
      setTimeout(() => setSyncStarted(false), 8000);
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  }

  if (status === null) return null;

  if (!status.connected) {
    if (!status.configured) return null;
    return (
      <section className="card sync-bar">
        <p className="muted">Connect Dropbox to automatically sync Apple Health data.</p>
        <a href={`/api/health/dropbox/connect?token=${getToken()}`} style={{ textDecoration: 'none' }}>
          <button type="button">Connect Dropbox</button>
        </a>
      </section>
    );
  }

  return (
    <section className="card sync-bar">
      <p className="muted">
        {status.lastSyncedAt
          ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
          : 'Waiting for first sync…'}
        {status.lastSyncError ? ` — last attempt failed: ${status.lastSyncError}` : ''}
        {syncStarted ? ' — sync started, this can take a few minutes' : ''}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={() => syncNow(true)} disabled={syncing}>
          Re-sync all
        </button>
        <button type="button" className="secondary" onClick={() => syncNow(false)} disabled={syncing}>
          {syncing ? 'Starting…' : 'Sync now'}
        </button>
      </div>
    </section>
  );
}
