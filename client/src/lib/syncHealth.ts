import type { SyncStatusBase } from '../api/types';

export type SyncState =
  /** Connected, but no run has ever succeeded. */
  | 'never'
  /** The last run succeeded and brought everything through. */
  | 'ok'
  /** The last run succeeded, but some days or activities did not import. */
  | 'partial'
  /** The last run failed outright — nothing new landed. */
  | 'failed';

/**
 * A successful run writes the same instant to `lastSyncedAt` and
 * `lastAttemptedAt`; a failed one moves only `lastAttemptedAt`. So an attempt
 * newer than the last success means the most recent run failed, while an error
 * recorded alongside a matching success means it landed with items missing.
 *
 * Rows written before `lastAttemptedAt` existed have it null. Those read as
 * 'partial' rather than 'failed' until their next run — the wording covers
 * both, and one sync cycle later the columns are populated.
 */
export function deriveSyncState(status: SyncStatusBase): SyncState {
  const synced = status.lastSyncedAt ? Date.parse(status.lastSyncedAt) : null;
  const attempted = status.lastAttemptedAt ? Date.parse(status.lastAttemptedAt) : null;

  if (attempted !== null && (synced === null || attempted > synced)) return 'failed';
  if (synced === null) return 'never';
  return status.lastSyncError ? 'partial' : 'ok';
}

export interface SyncErrorExplanation {
  /** What went wrong, in the user's terms. */
  summary: string;
  /** What to do about it. */
  advice: string;
}

// Matched in order against the raw error the sync run recorded. Garmin, Strava
// and Dropbox each phrase an HTTP failure differently — "ERROR: (429)" from
// garmin-connect's generic formatter, "status code 401" from an axios client —
// so the status codes are matched bare rather than in one library's wrapping.
// Anything unrecognised falls through to the generic explanation, with the raw
// text still one tap away.
const KNOWN_FAILURES: (SyncErrorExplanation & { pattern: RegExp })[] = [
  {
    pattern: /\b429\b|rate.?limit|too many requests/i,
    summary: 'The service is rate-limiting this server.',
    advice: 'Wait 30 to 60 minutes before trying again — retrying while blocked can extend it.',
  },
  {
    pattern: /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[_ ]grant|invalid token|token (has )?(expired|been revoked)/i,
    summary: 'The connection is no longer authorised.',
    advice: 'Disconnect and connect again to sign back in.',
  },
  {
    pattern: /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|timed out/i,
    summary: 'The service could not be reached.',
    advice: 'Usually temporary — try again in a few minutes.',
  },
  {
    pattern: /\(5\d\d\)|status(?: code)? 5\d\d|internal server error|bad gateway|service unavailable/i,
    summary: 'The service returned an error of its own.',
    advice: 'Nothing to fix on this end — try again later.',
  },
  {
    pattern: /is not connected for this account/i,
    summary: 'This account is no longer connected.',
    advice: 'Connect it again to resume syncing.',
  },
  {
    pattern: /could not be imported|imported incomplete/i,
    summary: 'The sync ran, but some items did not come through.',
    advice: 'Usually a one-off — the next sync normally picks them up.',
  },
];

/** Turns the raw error a sync run recorded into something worth reading. */
export function explainSyncError(raw: string): SyncErrorExplanation {
  const match = KNOWN_FAILURES.find((f) => f.pattern.test(raw));
  if (match) return { summary: match.summary, advice: match.advice };
  return {
    summary: 'The sync failed.',
    advice: 'Try again — the details say what the service reported.',
  };
}

// Syncs run every 15-30 minutes, so data older than this means something is
// wrong even when no run has reported an error — most often the server being
// asleep or restarted, which leaves no failure behind.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export function isStale(status: SyncStatusBase): boolean {
  if (!status.lastSyncedAt) return false;
  return Date.now() - Date.parse(status.lastSyncedAt) > STALE_AFTER_MS;
}
