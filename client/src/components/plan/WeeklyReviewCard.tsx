import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { WeeklyReview } from '../../api/types';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const TYPE_LABEL: Record<string, string> = {
  RUN: 'Running',
  RIDE: 'Riding',
  STRENGTH: 'Strength',
  SWIM: 'Swimming',
  WALK: 'Walking',
  BADMINTON: 'Badminton',
  OTHER: 'Other',
};

function formatRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const start = new Date(`${startIso}T00:00:00Z`).toLocaleDateString(undefined, opts);
  const end = new Date(`${endIso}T00:00:00Z`).toLocaleDateString(undefined, opts);
  return `${start} – ${end}`;
}

/** Plain-language verdict on the week, so the numbers don't have to be read to be understood. */
function verdict(review: WeeklyReview): string {
  const { ctlDelta } = review.fitness;
  const missed = review.plannedSessions - review.completedSessions;

  if (review.plannedSessions === 0 && review.actualHours === 0) return 'Nothing logged and nothing planned.';
  if (ctlDelta == null) return `${review.actualHours}h logged.`;

  const direction = ctlDelta > 0.5 ? 'Fitness went up' : ctlDelta < -0.5 ? 'Fitness slipped' : 'Fitness held steady';
  const missedNote =
    missed > 0 ? ` You missed ${missed} planned session${missed === 1 ? '' : 's'}.` : ' You did everything planned.';
  return `${direction}.${review.plannedSessions > 0 ? missedNote : ''}`;
}

/**
 * How last week actually went, against what the plan asked for. The app could
 * already say what to do today and how fresh you were, but never whether the
 * week added up.
 */
export default function WeeklyReviewCard() {
  const [weeksAgo, setWeeksAgo] = useState(1);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<WeeklyReview>(`/training-plan/review?weeksAgo=${weeksAgo}`)
      .then(setReview)
      .finally(() => setLoading(false));
  }, [weeksAgo]);

  if (loading && !review) {
    return (
      <div className="gd-review-card">
        <div className="gd-sec-title">
          <span className="gd-flag" />
          <h4>Last week</h4>
        </div>
        <p className="muted">Adding it up…</p>
      </div>
    );
  }
  if (!review) return null;

  const { fitness } = review;
  const delta = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v}`);

  return (
    <div className="gd-review-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>{weeksAgo === 1 ? 'Last week' : formatRange(review.weekStart, review.weekEnd)}</h4>
        <div className="gd-review-nav">
          <button type="button" className="gd-why-btn" onClick={() => setWeeksAgo((w) => w + 1)}>
            ‹
          </button>
          <button
            type="button"
            className="gd-why-btn"
            onClick={() => setWeeksAgo((w) => Math.max(1, w - 1))}
            disabled={weeksAgo <= 1}
          >
            ›
          </button>
        </div>
      </div>
      <div className="gd-sec-under" />

      <p className="gd-review-verdict">{verdict(review)}</p>

      <div className="gd-review-strip">
        {review.days.map((day, i) => {
          const planned = day.planned && !day.planned.isRestDay;
          const did = day.actual.length > 0;
          const state = planned ? (day.completed ? 'hit' : 'miss') : did ? 'extra' : 'rest';
          return (
            <div key={day.date} className={`gd-review-day gd-review-${state}`}>
              <span className="gd-review-letter">{DAY_LETTERS[i]}</span>
              <span className="gd-review-dot" />
            </div>
          );
        })}
      </div>

      <div className="gd-review-stats">
        <div>
          <span className="gd-review-stat mono">
            {review.completedSessions}/{review.plannedSessions}
          </span>
          <span className="gd-review-stat-label">sessions</span>
        </div>
        <div>
          <span className="gd-review-stat mono">{review.actualHours}h</span>
          <span className="gd-review-stat-label">of {review.plannedHours}h planned</span>
        </div>
        <div>
          <span className="gd-review-stat mono">{review.actualTss}</span>
          <span className="gd-review-stat-label">training load</span>
        </div>
      </div>

      {review.byDiscipline.length > 0 && (
        <ul className="gd-review-breakdown">
          {review.byDiscipline.map((d) => (
            <li key={d.type}>
              <span className="gd-review-sport">{TYPE_LABEL[d.type] ?? d.type}</span>
              <span className="gd-review-sport-val mono">
                {d.hours}h · {d.tss}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="gd-review-fitness">
        <span>
          This week <strong className="mono">{delta(fitness.ctlDelta)}</strong>
        </span>
        <span>
          4 weeks <strong className="mono">{delta(fitness.ctlDelta4w)}</strong>
        </span>
        <span>
          12 weeks <strong className="mono">{delta(fitness.ctlDelta12w)}</strong>
        </span>
      </div>

      {review.target && (
        <p className="gd-set-note gd-review-target">
          {review.target.daysToEvent >= 0
            ? `${review.target.daysToEvent} days to ${review.target.name}.`
            : `${review.target.name} has been and gone.`}
          {review.target.goalsAhead > 1 &&
            ` ${review.target.goalsAhead - 1} more goal${review.target.goalsAhead === 2 ? '' : 's'} after that.`}
        </p>
      )}
    </div>
  );
}
