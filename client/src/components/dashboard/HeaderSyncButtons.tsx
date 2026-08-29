import { useState } from 'react';
import { apiFetch } from '../../api/client';
import type { DropboxSyncStatus } from '../../api/types';

export default function HeaderSyncButtons({
  status,
  onSynced,
}: {
  status: DropboxSyncStatus | null;
  onSynced: () => void;
}) {
  const [syncing, setSyncing] = useState(false);

  if (!status?.connected) return null;

  async function syncNow(force: boolean) {
    setSyncing(true);
    try {
      await apiFetch(`/health/dropbox/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      onSynced();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="dash-sync-icons">
      <button
        type="button"
        className="icon-button"
        title="Re-sync all history"
        aria-label="Re-sync all history"
        onClick={() => syncNow(true)}
        disabled={syncing}
      >
        ⟲
      </button>
      <button
        type="button"
        className="icon-button"
        title="Sync now"
        aria-label="Sync now"
        onClick={() => syncNow(false)}
        disabled={syncing}
      >
        {syncing ? '…' : '⟳'}
      </button>
    </div>
  );
}
