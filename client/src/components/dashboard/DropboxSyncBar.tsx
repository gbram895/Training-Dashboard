import { getToken } from '../../api/client';
import type { DropboxSyncStatus } from '../../api/types';

export default function DropboxSyncBar({ status }: { status: DropboxSyncStatus | null }) {
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
          ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`
          : 'Waiting for first sync…'}
        {status.lastSyncError ? ` — last attempt failed: ${status.lastSyncError}` : ''}
      </p>
    </section>
  );
}
