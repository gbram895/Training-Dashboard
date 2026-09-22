import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { FitnessForecast, Freshness, GoalForecast } from '../../api/types';

const FRESHNESS: Record<Freshness, { label: string; tone: string }> = {
  fresh: { label: 'arriving fresh', tone: 'good' },
  neutral: { label: 'holding form', tone: 'neutral' },
  fatigued: { label: 'carrying fatigue', tone: 'warn' },
};

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function countdown(days: number): string {
  if (days <= 0) return 'this week';
  if (days < 21) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `in ${Math.round(days / 7)} weeks`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * How fit — and how fresh — the current plan has the athlete on course to be
 * for each goal still ahead. It reads off the same forward projection as the
 * season chart, sampled on each goal's own date, so "fitness at the goal" stops
 * being something you have to trace along the bars yourself.
 *
 * Fitness is CTL (how much training you can carry); form is TSB (how fresh you
 * are on the day, which is what the taper buys). Both are a projection from
 * where you are right now, re-derived on every load — a course, not a promise.
 */
export default function GoalForecastCard({ reloadKey }: { reloadKey: number }) {
  const [forecast, setForecast] = useState<FitnessForecast | null>(null);

  useEffect(() => {
    apiFetch<FitnessForecast>('/training-plan/forecast')
      .then(setForecast)
      .catch(() => setForecast(null));
  }, [reloadKey]);

  if (!forecast || forecast.goals.length === 0) return null;
  const goals = forecast.goals;

  const current = Math.round(forecast.currentCtl);

  return (
    <div className="gd-forecast-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>Fitness at each goal</h4>
      </div>

      <p className="gd-set-note">
        Where the plan has your fitness headed for each event, projected from today's{' '}
        <strong className="mono">{current}</strong>. Fitness is how much training you can carry; form is how fresh you
        arrive on the day. A projection from where you are now, not a promise.
      </p>

      <div className="gd-forecast-list">
        {goals.map((g) => (
          <GoalForecastRow key={g.id} goal={g} />
        ))}
      </div>

      <ThresholdBasis forecast={forecast} />
    </div>
  );
}

/**
 * Where the FTP and threshold-pace projections come from — or, when there
 * isn't enough to measure a rate of change from, why there is no number.
 *
 * This is shown rather than hidden on purpose. These two values are the
 * denominator of every training-load number in the app, so a projection of them
 * is only worth anything if you can see what it was read off.
 */
function ThresholdBasis({ forecast }: { forecast: FitnessForecast }) {
  const projected = forecast.goals.some(
    (g) => g.projectedFtpWatts != null || g.projectedThresholdPaceSecPerKm != null,
  );
  return (
    <div className="gd-forecast-basis">
      <p>
        <strong>FTP</strong> {forecast.ftpBasis}
        {forecast.currentFtpWatts != null && <> · now {forecast.currentFtpWatts}W</>}
      </p>
      <p>
        <strong>Pace</strong> {forecast.paceBasis}
        {forecast.currentThresholdPaceSecPerKm != null && (
          <> · now {formatPace(forecast.currentThresholdPaceSecPerKm)}/km</>
        )}
      </p>
      {projected && (
        <p className="gd-forecast-caveat">
          These carry your own recent rate of change forward over the build weeks before each goal, easing off the
          further out it gets — training load doesn't translate into watts on a fixed exchange rate, so treat them as a
          trend, not a test result. Check Settings &rarr; Calibration if the current values look wrong.
        </p>
      )}
    </div>
  );
}

function GoalForecastRow({ goal }: { goal: GoalForecast }) {
  const fresh = FRESHNESS[goal.freshness];
  return (
    <div className="gd-forecast-row">
      <div className="gd-forecast-head">
        <span className={`gd-priority-tag gd-priority-${goal.priority.toLowerCase()}`}>{goal.priority}</span>
        <span className="gd-forecast-name">{goal.name}</span>
        {goal.isAnchor && <span className="gd-forecast-anchor">building for</span>}
        <span className="gd-forecast-when mono">
          {formatDate(goal.date)} · {countdown(goal.daysAway)}
        </span>
      </div>

      <div className="gd-forecast-metrics">
        <div className="gd-forecast-metric">
          <span className="gd-forecast-num mono">{Math.round(goal.projectedCtl)}</span>
          <span className="gd-forecast-lbl">
            Fitness{' '}
            {goal.ctlDelta !== 0 && (
              <em className={`mono gd-delta gd-delta-${goal.ctlDelta > 0 ? 'up' : 'down'}`}>{signed(goal.ctlDelta)}</em>
            )}
          </span>
        </div>
        <div className="gd-forecast-metric">
          <span className={`gd-forecast-num mono gd-form-${fresh.tone}`}>{signed(goal.projectedTsb)}</span>
          <span className="gd-forecast-lbl">Form · {fresh.label}</span>
        </div>
      </div>

      {(goal.projectedFtpWatts != null || goal.projectedThresholdPaceSecPerKm != null) && (
        <div className="gd-forecast-thresholds">
          {goal.projectedFtpWatts != null && (
            <span>
              FTP <strong className="mono">{goal.projectedFtpWatts}W</strong>
            </span>
          )}
          {goal.projectedThresholdPaceSecPerKm != null && (
            <span>
              Threshold pace <strong className="mono">{formatPace(goal.projectedThresholdPaceSecPerKm)}/km</strong>
            </span>
          )}
          <span className="gd-forecast-buildweeks">
            over {goal.buildWeeks} build week{goal.buildWeeks === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {goal.peakCtl != null && goal.meetsPeak != null && (
        <p className={`gd-forecast-target ${goal.meetsPeak ? 'gd-forecast-ok' : 'gd-forecast-short'}`}>
          {goal.meetsPeak
            ? `On track for your target of ${Math.round(goal.peakCtl)}.`
            : `Short of your target of ${Math.round(goal.peakCtl)} by about ${Math.max(
                1,
                Math.round(goal.peakCtl - goal.projectedCtl),
              )} — more runway or a steeper ramp would close it.`}
        </p>
      )}
    </div>
  );
}
