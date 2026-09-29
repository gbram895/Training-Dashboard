import { Link } from 'react-router-dom';
import type { CheckVerdict, RepIntensity, RepVerdict, SessionGrade, SessionReview, WorkoutCategory } from '../api/types';

/**
 * How the session that was done measured up against the session that was asked
 * for. Everything shown here is decided server-side (see
 * server/src/lib/sessionReview.ts) — this renders the verdict, it does not
 * form one.
 *
 * The one rule this component keeps is about tone: the grade word and the
 * headline say the same thing, and neither is softened. A session that did not
 * happen says so, and training load is shown last and labelled as context,
 * because leading with "you matched the load" is exactly how an athlete gets
 * congratulated for missing a session.
 */

const GRADE: Record<SessionGrade, { word: string; tone: string }> = {
  NAILED: { word: 'Nailed it', tone: 'good' },
  SOLID: { word: 'Solid', tone: 'good' },
  OFF: { word: 'Off the mark', tone: 'warn' },
  MISSED: { word: 'Missed', tone: 'crit' },
  REST_DAY: { word: 'Rest day', tone: 'neutral' },
  UNJUDGED: { word: 'No verdict', tone: 'neutral' },
};

const VERDICT_TONE: Record<CheckVerdict, string> = { GOOD: 'good', FAIR: 'warn', POOR: 'crit' };
const REP_TONE: Record<RepVerdict, string> = { ...VERDICT_TONE, MISSED: 'crit' };
const VERDICT_RANK: Record<CheckVerdict, number> = { POOR: 0, FAIR: 1, GOOD: 2 };

const INTENSITY_MARK: Record<RepIntensity, string> = {
  ON: 'on target',
  UNDER: 'under',
  OVER: 'over',
  UNJUDGED: '',
};

function clock(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BAND_LABEL: Record<WorkoutCategory, string> = {
  ENDURANCE: 'Easy',
  TEMPO: 'Tempo',
  THRESHOLD: 'Threshold',
  VO2MAX: 'VO2max',
};

function mins(value: number): string {
  if (value < 60) return `${value} min`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export default function SessionReviewCard({ review, compact }: { review: SessionReview; compact?: boolean }) {
  // Nothing planned means nothing to compare against — no card rather than an
  // empty one saying so.
  if (!review.planned) return null;

  const grade = GRADE[review.grade];
  const plannedName = review.planned.isRestDay ? 'Rest day' : (review.planned.name ?? 'Planned session');

  if (compact) {
    // Whichever of time-in-zone and rep-by-rep has more to say — on a tie the
    // rep-by-rep, being the more specific of the two.
    const lead =
      review.checks
        .filter((c) => c.key === 'execution' || c.key === 'structure')
        .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || (a.key === 'structure' ? -1 : 1))[0] ??
      review.checks[0];
    const target = review.workoutIds[0];
    const body = (
      <>
        <div className="gd-sr-top">
          <span className={`gd-sr-pill gd-sr-${grade.tone}`}>{grade.word}</span>
          <span className="gd-sr-headline">{review.headline}</span>
        </div>
        <p className="gd-sr-compact-note">
          <strong>{plannedName}</strong>
          {lead ? ` — ${lead.note}` : ''}
        </p>
      </>
    );
    return target ? (
      <Link to={`/workouts/${target}`} className="gd-sr-card gd-sr-compact">
        {body}
      </Link>
    ) : (
      <div className="gd-sr-card gd-sr-compact">{body}</div>
    );
  }

  // Only worth drawing when both sides of it are known: a planned shape with no
  // measured effort to set against it is a chart of one column. Bands neither
  // asked for nor ridden are left out rather than drawn as two empty rules.
  const bands = review.bands.filter(
    (b) => b.plannedMin != null && b.actualMin != null && (b.plannedMin > 0 || b.actualMin > 0),
  );
  const bandScale = Math.max(1, ...bands.map((b) => Math.max(b.plannedMin ?? 0, b.actualMin ?? 0)));

  return (
    <div className="gd-sr-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>Against the plan</h4>
      </div>

      <div className="gd-sr-top">
        <span className={`gd-sr-pill gd-sr-${grade.tone}`}>{grade.word}</span>
        <span className="gd-sr-headline">{review.headline}</span>
        {review.score != null && <span className="gd-sr-score mono">{review.score}</span>}
      </div>

      <p className="gd-sr-planned">
        The plan asked for <strong>{plannedName}</strong>
        {review.planned.durationMin ? `, ${mins(review.planned.durationMin)}` : ''}.
      </p>

      {review.checks.length > 0 && (
        <ul className="gd-sr-checks">
          {review.checks.map((check) => (
            <li key={check.key} className={`gd-sr-check gd-sr-${VERDICT_TONE[check.verdict]}`}>
              <div className="gd-sr-check-head">
                <span className="gd-sr-check-label">{check.label}</span>
                {check.planned && (
                  <span className="gd-sr-check-values mono">
                    {check.planned} → {check.actual ?? '—'}
                  </span>
                )}
              </div>
              <p className="gd-sr-check-note">{check.note}</p>
            </li>
          ))}
        </ul>
      )}

      {review.structure && review.structure.reps.length > 0 && (
        <div className="gd-sr-reps">
          <p className="gd-sr-bands-title">Each rep, asked for → done</p>
          <ol className="gd-sr-rep-list">
            {review.structure.reps.map((rep) => (
              <li key={rep.index} className={`gd-sr-rep gd-sr-${REP_TONE[rep.verdict]}`}>
                <span className="gd-sr-rep-index mono">{rep.index}</span>
                <span className="gd-sr-rep-planned mono">
                  {clock(rep.plannedSec)}
                  {rep.plannedTarget ? ` · ${rep.plannedTarget}` : ''}
                </span>
                <span className="gd-sr-rep-actual mono">
                  {rep.actualSec == null
                    ? 'not done'
                    : `${clock(rep.actualSec)}${rep.actualValue ? ` · ${rep.actualValue}` : ''}`}
                </span>
                <span className="gd-sr-rep-mark">
                  {rep.intensity && rep.intensity !== 'ON' ? INTENSITY_MARK[rep.intensity] : ''}
                </span>
              </li>
            ))}
          </ol>
          {review.structure.extraEfforts > 0 && (
            <p className="gd-sr-legend">
              + {review.structure.extraEfforts} hard {review.structure.extraEfforts === 1 ? 'effort' : 'efforts'} the plan
              didn't ask for
            </p>
          )}
        </div>
      )}

      {bands.length > 0 && (
        <div className="gd-sr-bands">
          <p className="gd-sr-bands-title">Where the time went</p>
          {bands.map((band) => (
            <div key={band.band} className="gd-sr-band">
              <span className="gd-sr-band-label">{BAND_LABEL[band.band]}</span>
              <div className="gd-sr-band-bars">
                <div className="gd-sr-band-bar gd-sr-band-planned" style={{ width: `${((band.plannedMin ?? 0) / bandScale) * 100}%` }} />
                <div className="gd-sr-band-bar gd-sr-band-actual" style={{ width: `${((band.actualMin ?? 0) / bandScale) * 100}%` }} />
              </div>
              <span className="gd-sr-band-values mono">
                {band.plannedMin} → {band.actualMin}
              </span>
            </div>
          ))}
          <p className="gd-sr-legend">
            <span className="gd-sr-key gd-sr-band-planned" /> asked for
            <span className="gd-sr-key gd-sr-band-actual" /> done
          </p>
        </div>
      )}

      {review.notes.length > 0 && (
        <ul className="gd-sr-notes">
          {review.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {(review.load.actualTss != null || review.load.plannedTss != null) && (
        <p className="gd-sr-load">
          Training load {review.load.actualTss ?? '—'}
          {review.load.plannedTss != null ? ` against roughly ${review.load.plannedTss} expected` : ''}. Context only —
          a long easy ride and a short hard one can cost the same and train nothing alike, which is why the verdict
          above is not built on it.
        </p>
      )}
    </div>
  );
}
