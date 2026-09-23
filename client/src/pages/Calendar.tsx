import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { CalendarRange } from '../api/types';
import PageHead from '../components/PageHead';
import PlanViewSwitch from '../components/calendar/PlanViewSwitch';
import MonthGrid from '../components/calendar/MonthGrid';
import YearGrid from '../components/calendar/YearGrid';
import DayDetailCard from '../components/calendar/DayDetailCard';
import { useCachedState } from '../lib/pageCache';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import {
  dayStatus,
  daysOfYear,
  indexDays,
  monthGrid,
  monthLabel,
  todayKeyUTC,
  totalsFor,
} from '../lib/calendarData';
import { formatDuration } from '../lib/format';

function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}

/**
 * The training year on one page: what the plan asked for and what was actually
 * trained, on the same grid, a month at a time or a whole year at once.
 *
 * A year is fetched in a single request and kept, so flipping between months —
 * and between the month and the year — costs nothing. That matters more than
 * usual here: the API sleeps between uses on the free tier, so twelve small
 * requests would each pay that wake-up cost.
 */
export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'year' ? 'year' : 'month';

  const today = todayKeyUTC();
  const [year, setYear] = useState(() => Number(params.get('year')) || yearOf(today));
  const [month, setMonth] = useState(() => {
    const raw = Number(params.get('month'));
    return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw - 1 : new Date().getUTCMonth();
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [years, setYears] = useCachedState<Record<string, CalendarRange>>('calendar.years', {});
  // The setter from the page cache replaces wholesale, so the latest value has
  // to be readable at the moment a fetch lands rather than closed over.
  const yearsRef = useRef(years);
  yearsRef.current = years;
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((target: number) => {
    apiFetch<CalendarRange>(`/calendar?from=${target}-01-01&to=${target}-12-31`)
      .then((range) => {
        // The ref is updated here as well as on render, so two years fetched
        // close together can't overwrite one another.
        const next = { ...yearsRef.current, [target]: range };
        yearsRef.current = next;
        setYears(next);
        setError(null);
      })
      .catch(() => setError("Couldn't load your calendar."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(year);
  }, [year, load]);

  useRefreshOnResume(() => load(year));

  const range = years[year] ?? null;
  const byDay = useMemo(() => indexDays(range?.days ?? []), [range]);
  const planHorizon = range?.planHorizon ?? today;
  const weeklyHours = range?.weeklyHours ?? null;

  const monthKeys = useMemo(
    () =>
      monthGrid(year, month)
        .flat()
        .filter((cell) => cell.inMonth)
        .map((cell) => cell.key),
    [year, month],
  );

  const monthTotals = useMemo(
    () => totalsFor(monthKeys, byDay, today, planHorizon, weeklyHours),
    [monthKeys, byDay, today, planHorizon, weeklyHours],
  );
  const yearTotals = useMemo(
    () => totalsFor(daysOfYear(year), byDay, today, planHorizon, weeklyHours),
    [year, byDay, today, planHorizon, weeklyHours],
  );

  function setView(next: 'month' | 'year') {
    const nextParams = new URLSearchParams(params);
    nextParams.set('view', next);
    setParams(nextParams, { replace: true });
  }

  function stepMonth(delta: number) {
    setSelectedDay(null);
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  }

  function openMonth(target: number) {
    setMonth(target);
    setSelectedDay(null);
    setView('month');
  }

  function goToToday() {
    setYear(yearOf(today));
    setMonth(new Date().getUTCMonth());
    setSelectedDay(view === 'month' ? today : null);
  }

  const totals = view === 'month' ? monthTotals : yearTotals;
  const loading = !range && !error;
  // Nothing at all in this month or year — worth saying, since an empty grid
  // looks the same whether the data is missing or the training was.
  const monthEmpty = monthKeys.every((key) => !byDay.has(key));
  const yearEmpty = (range?.days.length ?? 0) === 0;

  return (
    <div className="page">
      <div className="gd-cal-top">
        <PageHead title="Calendar" />
        <PlanViewSwitch active={view} />

        <div className="gd-cal-nav">
          <button type="button" className="gd-cal-step" onClick={() => (view === 'month' ? stepMonth(-1) : setYear(year - 1))} aria-label="Previous">
            ‹
          </button>
          <h2 className="gd-cal-title">{view === 'month' ? monthLabel(year, month) : year}</h2>
          <button type="button" className="gd-cal-step" onClick={() => (view === 'month' ? stepMonth(1) : setYear(year + 1))} aria-label="Next">
            ›
          </button>
        </div>

        <div className="gd-cal-summary">
          <span>
            <strong className="mono">{totals.sessions}</strong> session{totals.sessions === 1 ? '' : 's'}
          </span>
          <span>
            <strong className="mono">{formatDuration(totals.minutes)}</strong>
          </span>
          {totals.distanceKm > 0 && (
            <span>
              <strong className="mono">{Math.round(totals.distanceKm)}</strong> km
            </span>
          )}
          {totals.tss > 0 && (
            <span>
              <strong className="mono">{Math.round(totals.tss)}</strong> TSS
            </span>
          )}
          {totals.missed > 0 && <span className="gd-cal-missed-count">{totals.missed} missed</span>}
        </div>

        {error && <p className="muted">{error}</p>}
        {loading && <p className="muted">Loading…</p>}

        {range && view === 'month' && (
          <>
            <MonthGrid
              year={year}
              month={month}
              byDay={byDay}
              todayKey={today}
              planHorizon={planHorizon}
              weeklyHours={weeklyHours}
              selected={selectedDay}
              onSelect={setSelectedDay}
            />
            {monthEmpty && (
              <p className="gd-cal-hint">Nothing planned or trained in {monthLabel(year, month)}.</p>
            )}
            {selectedDay ? (
              <DayDetailCard
                dayKey={selectedDay}
                day={byDay.get(selectedDay)}
                status={dayStatus(selectedDay, byDay.get(selectedDay), today, planHorizon, weeklyHours)}
                onClose={() => setSelectedDay(null)}
              />
            ) : (
              !monthEmpty && <p className="gd-cal-hint">Tap a day to see what was planned and what you did.</p>
            )}
            <div className="gd-cal-legend">
              <span>
                <i className="gd-cal-dot" style={{ background: 'var(--chart-ride)' }} /> done
              </span>
              <span>
                <i className="gd-cal-ring" style={{ borderColor: 'var(--chart-ride)' }} /> planned
              </span>
              <span>
                <i className="gd-cal-dash" /> rest
              </span>
              <span>
                <i className="gd-cal-legend-missed" /> missed
              </span>
            </div>
          </>
        )}

        {range && view === 'year' && (
          <>
            <YearGrid
              year={year}
              byDay={byDay}
              todayKey={today}
              planHorizon={planHorizon}
              weeklyHours={weeklyHours}
              onOpenMonth={openMonth}
            />
            <div className="gd-cal-legend">
              <span>Lighter</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={`gd-cal-mini-day gd-heat-${level} gd-cal-legend-heat`} />
              ))}
              <span>Harder</span>
              <span className="gd-cal-legend-sep">
                <i className="gd-cal-mini-day gd-cal-mini-planned gd-cal-legend-heat" /> ahead
              </span>
            </div>
            <p className="gd-cal-hint">
              {yearEmpty ? `Nothing planned or trained in ${year}.` : 'Tap a month to open it.'}
            </p>
          </>
        )}

        {(year !== yearOf(today) || (view === 'month' && month !== new Date().getUTCMonth())) && (
          <button type="button" className="gd-why-btn" onClick={goToToday}>
            Back to today
          </button>
        )}
      </div>
    </div>
  );
}
