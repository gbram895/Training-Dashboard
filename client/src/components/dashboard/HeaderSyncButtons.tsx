import { useState } from 'react';
import { apiFetch } from '../../api/client';
import type { DropboxSyncStatus, SyncNowResult } from '../../api/types';

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
      // A plain sync is awaited server-side, so by the time this resolves the
      // new data is in the database and refetching actually shows it. A force
      // backfill still runs on in the background — refetching then just picks
      // up whatever has landed so far.
      await apiFetch<SyncNowResult>(`/health/dropbox/sync-now${force ? '?force=true' : ''}`, { method: 'POST' });
    } catch {
      // Swallowed on purpose: the sync run records why it failed, and the
      // refetch below pulls that back as the sync bar's lastSyncError.
    } finally {
      setSyncing(null);
      onSynced();
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
