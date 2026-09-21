import type { SyncStatusBase } from '../../api/types';
import { formatTimeAgo } from '../../lib/format';
import { deriveSyncState, explainSyncError, isStale } from '../../lib/syncHealth';

export interface BannerSource {
  /** Path segment of the source's API routes, e.g. "garmin". */
  key: string;
  name: string;
  status: SyncStatusBase | null;
}

/**
 * Top-of-dashboard answer to "is what I'm looking at up to date?". The per-source
 * sync bars live below the "More" divider, which is a long scroll away and inside
 * a lazily loaded chunk — a failing sync has to be visible before that.
 */
function listNames(sources: BannerSource[]): string {
  return sources.map((s) => s.name).join(' and ');
}

export default function SyncHealthBanner({
  sources,
  unavailable = false,
  retrying = false,
  onRetry,
}: {
  sources: BannerSource[];
  /** The status requests themselves failed, so nothing is known. */
  unavailable?: boolean;
  retrying?: boolean;
  onRetry: (keys: string[]) => void;
}) {
  const connected = sources.filter(
    (s): s is BannerSource & { status: SyncStatusBase } => s.status !== null && s.status.connected,
  );

  if (unavailable) {
    return (
      <div className="gd-sync-banner is-warn">
        <span className="sync-dot" aria-hidden="true" />
        <div className="gd-sync-banner-text">
          <p className="gd-sync-banner-headline">Sync status could not be checked</p>
          <p className="gd-sync-banner-sub">The dashboard may be showing older data than it says.</p>
        </div>
      </div>
    );
  }

  if (connected.length === 0) return null;

  const failing = connected.filter((s) => deriveSyncState(s.status) === 'failed');
  const incomplete = connected.filter((s) => deriveSyncState(s.status) === 'partial');
  const stale = connected.filter((s) => deriveSyncState(s.status) === 'ok' && isStale(s.status));

  if (failing.length > 0) {
    const first = failing[0];
    const explanation = first.status.lastSyncError ? explainSyncError(first.status.lastSyncError) : null;
    const headline =
      failing.length === 1
        ? `${first.name} sync failed${first.status.lastAttemptedAt ? ` ${formatTimeAgo(first.status.lastAttemptedAt)}` : ''}`
        : `${listNames(failing)} syncs are failing`;

    return (
      <div className="gd-sync-banner is-bad">
        <span className="sync-dot" aria-hidden="true" />
        <div className="gd-sync-banner-text">
          <p className="gd-sync-banner-headline">{headline}</p>
          {failing.length === 1 && explanation && (
            <p className="gd-sync-banner-sub">
              {explanation.summary} {explanation.advice}
            </p>
          )}
          {failing.length === 1 && first.status.lastSyncedAt && (
            <p className="gd-sync-banner-sub">Showing data from {formatTimeAgo(first.status.lastSyncedAt)}.</p>
          )}
        </div>
        <button
          type="button"
          className="gd-sync-banner-action"
          disabled={retrying}
          onClick={() => onRetry(failing.map((s) => s.key))}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    );
  }

  // Freshness is only as good as the source that last succeeded — reporting the
  // newest would hide a source that stopped updating days ago.
  const oldestSuccess = connected
    .map((s) => s.status.lastSyncedAt)
    .filter((at): at is string => at !== null)
    .sort()[0];

  if (!oldestSuccess) {
    return (
      <div className="gd-sync-banner is-idle">
        <span className="sync-dot" aria-hidden="true" />
        <div className="gd-sync-banner-text">
          <p className="gd-sync-banner-headline">Waiting for the first sync</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`gd-sync-banner ${incomplete.length + stale.length > 0 ? 'is-warn' : 'is-good'}`}>
      <span className="sync-dot" aria-hidden="true" />
      <div className="gd-sync-banner-text">
        <p className="gd-sync-banner-headline">Synced {formatTimeAgo(oldestSuccess)}</p>
        {stale.length > 0 && (
          <p className="gd-sync-banner-sub">
            {listNames(stale)} {stale.length === 1 ? 'has' : 'have'} not synced in a while.
          </p>
        )}
        {incomplete.length > 0 && (
          <p className="gd-sync-banner-sub">{listNames(incomplete)} brought back less than expected.</p>
        )}
      </div>
    </div>
  );
}
