import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { Workout, WorkoutType } from '../api/types';
import { mondayOf } from '../lib/week';
import { useCachedState } from '../lib/pageCache';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { formatDuration } from '../lib/format';
import PageHead from '../components/PageHead';
import GradientActivityList from '../components/dashboard/GradientActivityList';
import { TYPE_ICON, TYPE_LABEL } from '../lib/workoutTypes';
import {
  DEFAULT_FILTERS,
  DURATION_OPTIONS,
  LOAD_OPTIONS,
  PERIOD_OPTIONS,
  RPE_OPTIONS,
  SORT_OPTIONS,
  activeFilterCount,
  applyFilters,
  isNarrowed,
  type Period,
  type RpeFilter,
  type Sort,
  type WorkoutFilters,
} from '../lib/workoutFilters';

const FILTER_ORDER: WorkoutType[] = ['RIDE', 'RUN', 'SWIM', 'STRENGTH', 'WALK', 'BADMINTON', 'OTHER'];

function weekLabel(date: string, thisMonday: number, lastMonday: number): string {
  const d = new Date(date);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (t >= thisMonday) return 'This week';
  if (t >= lastMonday) return 'Last week';
  return 'Earlier';
}

export default function Workouts() {
  const [workouts, setWorkouts] = useCachedState<Workout[] | null>('workouts.list', null);
  // Cached rather than local so opening a result and coming back doesn't throw
  // away the search that found it.
  const [filters, setFilters] = useCachedState<WorkoutFilters>('workouts.filters', DEFAULT_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);

  const update = <K extends keyof WorkoutFilters>(key: K, value: WorkoutFilters[K]) =>
    setFilters({ ...filters, [key]: value });

  const load = useCallback(() => {
    apiFetch<Workout[]>('/workouts').then(setWorkouts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRefreshOnResume(load);

  const loading = workouts === null;
  const list = workouts ?? [];

  const presentTypes = new Set(list.map((w) => w.type));
  const filterTypes = FILTER_ORDER.filter((t) => presentTypes.has(t));

  const filtered = applyFilters(list, filters);
  const extraCount = activeFilterCount(filters);
  const narrowed = isNarrowed(filters);

  // Sorting by length or load deliberately breaks the week grouping — the
  // point of those is one ranked list, not a ranked list per week.
  const grouped = filters.sort === 'RECENT';
  const thisMonday = mondayOf(new Date()).getTime();
  const lastMonday = thisMonday - 7 * 86_400_000;

  const groups: { label: string; workouts: Workout[] }[] = [];
  if (grouped) {
    for (const w of filtered) {
      const label = weekLabel(w.date, thisMonday, lastMonday);
      const current = groups[groups.length - 1];
      if (current?.label === label) current.workouts.push(w);
      else groups.push({ label, workouts: [w] });
    }
  } else {
    groups.push({ label: SORT_OPTIONS.find((o) => o.value === filters.sort)!.label, workouts: filtered });
  }

  const totalMin = filtered.reduce((sum, w) => sum + w.durationMin, 0);

  return (
    <div className="page">
      <div className="gd-workouts-top">
        <PageHead title="Workouts" />

        {!loading && list.length > 0 && (
          <>
            <div className="gd-search-bar">
              <div className="gd-search-field">
                <span className="gd-search-icon" aria-hidden="true">
                  🔍
                </span>
                <input
                  type="search"
                  className="gd-search-input"
                  placeholder="Search workouts"
                  aria-label="Search workouts"
                  value={filters.query}
                  onChange={(e) => update('query', e.target.value)}
                />
                {filters.query && (
                  <button
                    type="button"
                    className="gd-search-clear"
                    aria-label="Clear search"
                    onClick={() => update('query', '')}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`gd-filter-chip gd-filter-toggle${panelOpen || extraCount > 0 ? ' gd-on' : ''}`}
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen(!panelOpen)}
              >
                Filters{extraCount > 0 ? ` · ${extraCount}` : ''}
              </button>
            </div>

            {filterTypes.length > 1 && (
              <div className="gd-filter-row">
                <button
                  type="button"
                  className={`gd-filter-chip${filters.type === 'ALL' ? ' gd-on' : ''}`}
                  onClick={() => update('type', 'ALL')}
                >
                  All
                </button>
                {filterTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`gd-filter-chip${filters.type === t ? ' gd-on' : ''}`}
                    onClick={() => update('type', t)}
                  >
                    {TYPE_ICON[t]} {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}

            {panelOpen && (
              <div className="gd-filter-panel">
                <label>
                  When
                  <select value={filters.period} onChange={(e) => update('period', e.target.value as Period)}>
                    {PERIOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Length
                  <select value={filters.minDuration} onChange={(e) => update('minDuration', Number(e.target.value))}>
                    {DURATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Load
                  <select value={filters.minLoad} onChange={(e) => update('minLoad', Number(e.target.value))}>
                    {LOAD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  How it felt
                  <select value={filters.rpe} onChange={(e) => update('rpe', e.target.value as RpeFilter)}>
                    {RPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gd-filter-wide">
                  Order
                  <select value={filters.sort} onChange={(e) => update('sort', e.target.value as Sort)}>
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No workouts yet. Tap + to log your first session.</p>
        ) : filtered.length === 0 ? (
          <div className="gd-no-results">
            <p className="muted">Nothing matches that.</p>
            <button type="button" className="gd-filter-chip" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear search and filters
            </button>
          </div>
        ) : (
          <>
            {narrowed && (
              <p className="gd-result-summary">
                {filtered.length} workout{filtered.length === 1 ? '' : 's'} · {formatDuration(totalMin)}
                <button type="button" className="gd-result-reset" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear
                </button>
              </p>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="gd-week-label">{g.label}</div>
                <GradientActivityList workouts={g.workouts} />
              </div>
            ))}
          </>
        )}
      </div>

      <Link to="/workouts/new" className="fab" aria-label="Log workout">
        +
      </Link>
    </div>
  );
}
