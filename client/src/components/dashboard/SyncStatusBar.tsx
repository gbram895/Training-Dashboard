import { useState, type ReactNode } from 'react';
import type { SyncStatusBase } from '../../api/types';
import { formatTimeAgo } from '../../lib/format';
import { deriveSyncState, explainSyncError, isStale } from '../../lib/syncHealth';

/**
 * The connected state of a sync bar, shared by every source. A failure has to
 * read as a failure — coloured, explained, and with the retry right there —
 * rather than as more grey text in the same sentence as the success.
 */
export default function SyncStatusBar({
  name,
  status,
  note,
  syncing = false,
  onSyncNow,
  extraActions,
}: {
  name: string;
  status: SyncStatusBase;
  /** Transient outcome of a "sync now" press, e.g. "3 new workouts". */
  note?: string | null;
  syncing?: boolean;
  onSyncNow?: () => void;
  extraActions?: ReactNode;
}) {
  const [showDetail, setShowDetail] = useState(false);

  const state = deriveSyncState(status);
  const failed = state === 'failed';
  const stale = state === 'ok' && isStale(status);
  const tone = failed ? 'bad' : state === 'partial' || stale ? 'warn' : state === 'ok' ? 'good' : 'idle';

  const explanation = status.lastSyncError ? explainSyncError(status.lastSyncError) : null;

  let headline: string;
  if (failed) {
    headline = `${name} sync failed${status.lastAttemptedAt ? ` ${formatTimeAgo(status.lastAttemptedAt)}` : ''}`;
  } else if (state === 'never') {
    headline = `${name} hasn't synced yet`;
  } else {
    headline = `${name} synced ${formatTimeAgo(status.lastSyncedAt!)}`;
  }

  const lines: string[] = [];
  if (explanation) lines.push(explanation.summary, explanation.advice);
  if (failed && status.lastSyncedAt) lines.push(`Last successful sync ${formatTimeAgo(status.lastSyncedAt)}.`);
  if (stale) lines.push('That is longer than the usual gap between syncs, so this data may be out of date.');

  return (
    <section className={`card sync-bar sync-bar-${tone}`}>
      <div className="sync-bar-main">
        <span className="sync-dot" aria-hidden="true" />
        <div className="sync-bar-text">
          <p className="sync-bar-headline">{headline}</p>
          {lines.map((line) => (
            <p key={line} className="sync-bar-sub">
              {line}
            </p>
          ))}
          {note && <p className="sync-bar-note">{note}</p>}
          {status.lastSyncError && (
            <>
              <button
                type="button"
                className="sync-bar-details"
                aria-expanded={showDetail}
                onClick={() => setShowDetail((open) => !open)}
              >
                {showDetail ? 'Hide details' : 'Details'}
              </button>
              {showDetail && <p className="sync-bar-raw">{status.lastSyncError}</p>}
            </>
          )}
        </div>
      </div>
      <div className="sync-bar-actions">
        {onSyncNow && (
          <button type="button" className={failed ? undefined : 'secondary'} onClick={onSyncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : failed ? 'Try again' : 'Sync now'}
          </button>
        )}
        {extraActions}
      </div>
    </section>
  );
}
