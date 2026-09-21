import { useState } from 'react';
import { apiFetch, getToken } from '../../api/client';
import type { DropboxSyncStatus, SyncNowResult } from '../../api/types';
import { describeSyncResult } from '../../lib/syncResult';
import SyncStatusBar from './SyncStatusBar';

export default function DropboxSyncBar({
  status,
  onChanged,
}: {
  status: DropboxSyncStatus | null;
  onChanged: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const result = await apiFetch<SyncNowResult>('/health/dropbox/sync-now', { method: 'POST' });
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
    <SyncStatusBar name="Apple Health" status={status} note={syncNote} syncing={syncing} onSyncNow={syncNow} />
  );
}
