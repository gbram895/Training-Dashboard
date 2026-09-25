import type { Workout, WorkoutType } from '../api/types';
import { TYPE_LABEL } from './workoutTypes';

// Filtering runs in the browser rather than on the API. GET /workouts is not
// paginated — the Workouts screen already holds the athlete's whole history
// the moment it loads — so there is nothing to fetch that we don't have, and
// a round trip per keystroke would be a long wait on a free-tier instance
// that sleeps. If that endpoint ever starts paging, this logic has to move
// server-side, because a filter can only be trusted over the whole set.

export type Period = 'ALL' | '30D' | '3M' | '12M';
export type Sort = 'RECENT' | 'LONGEST' | 'HARDEST';
export type RpeFilter = 'ANY' | 'HARD' | 'EASY' | 'RATED';

export interface WorkoutFilters {
  query: string;
  type: WorkoutType | 'ALL';
  period: Period;
  /** Minutes; 0 = any. */
  minDuration: number;
  /** TSS; 0 = any. */
  minLoad: number;
  rpe: RpeFilter;
  sort: Sort;
}

export const DEFAULT_FILTERS: WorkoutFilters = {
  query: '',
  type: 'ALL',
  period: 'ALL',
  minDuration: 0,
  minLoad: 0,
  rpe: 'ANY',
  sort: 'RECENT',
};

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'ALL', label: 'All time' },
  { value: '30D', label: 'Last 30 days' },
  { value: '3M', label: 'Last 3 months' },
  { value: '12M', label: 'Last 12 months' },
];

export const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any length' },
  { value: 45, label: '45 min or more' },
  { value: 90, label: '1h30 or more' },
  { value: 180, label: '3h or more' },
];

export const LOAD_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any load' },
  { value: 50, label: 'TSS 50 or more' },
  { value: 100, label: 'TSS 100 or more' },
  { value: 150, label: 'TSS 150 or more' },
];

export const RPE_OPTIONS: { value: RpeFilter; label: string }[] = [
  { value: 'ANY', label: 'Any RPE' },
  { value: 'HARD', label: 'Felt hard (7+)' },
  { value: 'EASY', label: 'Felt easy (1-4)' },
  { value: 'RATED', label: 'Rated only' },
];

export const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'RECENT', label: 'Newest first' },
  { value: 'LONGEST', label: 'Longest first' },
  { value: 'HARDEST', label: 'Hardest first' },
];

const PERIOD_DAYS: Record<Exclude<Period, 'ALL'>, number> = { '30D': 30, '3M': 91, '12M': 365 };

// "Ventoux" should find "Ventoüx", and a lowercase query should find anything.
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Everything a text search looks at: the activity's name, the athlete's own
 *  notes, their post-workout feedback, and the discipline's label. */
function haystack(w: Workout): string {
  return normalize([w.title, w.notes, w.feedbackNotes, TYPE_LABEL[w.type]].filter(Boolean).join(' '));
}

/** Every whitespace-separated term has to appear, so extra words narrow. */
export function matchesQuery(w: Workout, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(w);
  return terms.every((t) => text.includes(t));
}

/** How many of the panel's filters are set, for the badge on the Filters button. */
export function activeFilterCount(f: WorkoutFilters): number {
  return (
    (f.period === DEFAULT_FILTERS.period ? 0 : 1) +
    (f.minDuration === DEFAULT_FILTERS.minDuration ? 0 : 1) +
    (f.minLoad === DEFAULT_FILTERS.minLoad ? 0 : 1) +
    (f.rpe === DEFAULT_FILTERS.rpe ? 0 : 1) +
    (f.sort === DEFAULT_FILTERS.sort ? 0 : 1)
  );
}

export function isNarrowed(f: WorkoutFilters): boolean {
  return f.query.trim() !== '' || f.type !== 'ALL' || activeFilterCount(f) > 0;
}

function matchesRpe(w: Workout, rpe: RpeFilter): boolean {
  if (rpe === 'ANY') return true;
  if (w.rpe == null) return false;
  if (rpe === 'RATED') return true;
  return rpe === 'HARD' ? w.rpe >= 7 : w.rpe <= 4;
}

export function applyFilters(workouts: Workout[], f: WorkoutFilters, now = new Date()): Workout[] {
  let cutoff = -Infinity;
  if (f.period !== 'ALL') cutoff = now.getTime() - PERIOD_DAYS[f.period] * 86_400_000;

  const filtered = workouts.filter((w) => {
    if (f.type !== 'ALL' && w.type !== f.type) return false;
    if (new Date(w.date).getTime() < cutoff) return false;
    if (w.durationMin < f.minDuration) return false;
    // A workout with no load recorded can't satisfy a minimum load; treating
    // it as zero and as a match would put untracked sessions in a list the
    // athlete asked to be the hard ones.
    if (f.minLoad > 0 && (w.tss == null || w.tss < f.minLoad)) return false;
    if (!matchesRpe(w, f.rpe)) return false;
    return matchesQuery(w, f.query);
  });

  if (f.sort === 'LONGEST') {
    return [...filtered].sort((a, b) => b.durationMin - a.durationMin);
  }
  if (f.sort === 'HARDEST') {
    // Unrated-for-load workouts sort last rather than as zero-load ties.
    return [...filtered].sort((a, b) => (b.tss ?? -1) - (a.tss ?? -1));
  }
  return filtered;
}
