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
  const [syncing, setSyncing] = useState<'all' | 'now' | null>(null);

  if (!status?.connected) return null;

  async function syncNow(force: boolean) {
    setSyncing(force ? 'all' : 'now');
    try {
      await apiFetch(`/health/dropbox/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
      onSynced();
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="dash-sync-icons">
      <button
        type="button"
        className={`icon-button${syncing === 'all' ? ' spinning' : ''}`}
        title="Re-sync all history"
        aria-label="Re-sync all history"
        onClick={() => syncNow(true)}
        disabled={syncing !== null}
      >
        ⟲
      </button>
      <button
        type="button"
        className={`icon-button${syncing === 'now' ? ' spinning' : ''}`}
        title="Sync now"
        aria-label="Sync now"
        onClick={() => syncNow(false)}
        disabled={syncing !== null}
      >
        ⟳
      </button>
    </div>
  );
}
