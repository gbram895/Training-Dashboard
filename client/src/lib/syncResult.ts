import type { SyncNowResult } from '../api/types';

/** Short, human phrasing of what a "sync now" press actually did. */
export function describeSyncResult(result: SyncNowResult): string {
  // Nothing to count yet: a force backfill is never awaited server-side, and a
  // plain sync that outlives the request's hold is handed back the same way.
  if (!result.completed) return 'still running, this can take a few minutes';

  const imported = result.workoutsImported ?? 0;
  const parts = [imported === 0 ? 'nothing new' : `${imported} new ${imported === 1 ? 'workout' : 'workouts'}`];

  const incomplete = result.activitiesDegraded ?? result.filesFailed ?? 0;
  if (incomplete > 0) parts.push(`${incomplete} incomplete`);

  return parts.join(', ');
}
