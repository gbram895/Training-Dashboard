import { useState } from 'react';
import type { RampBand, RampStatus } from '../../api/types';

/**
 * Is load climbing faster than it is being absorbed?
 *
 * Every judgement here is made server-side (server/src/lib/rampRate.ts) — this
 * renders it. Two rules of its own:
 *
 *  - A quiet card when nothing is wrong. A warning you only ever see in red is
 *    a warning you do not trust; seeing it sit at "steady" for weeks is what
 *    makes it mean something the day it turns. So STEADY renders as one line
 *    and CLIMBING/SPIKE open up.
 *  - It says how solid the number is. The ratio's bands are borrowed from
 *    research that later reanalyses have largely undermined, and pretending
 *    otherwise on a card that tells someone to train less would be dishonest.
 */

const BAND: Record<RampBand, { word: string; tone: string }> = {
  SPIKE: { word: 'Spike', tone: 'crit' },
  CLIMBING: { word: 'Climbing', tone: 'warn' },
  STEADY: { word: 'Steady', tone: 'good' },
  DETRAINING: { word: 'Easing off', tone: 'neutral' },
  UNKNOWN: { word: 'No read', tone: 'neutral' },
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export default function RampRateCard({ status }: { status: RampStatus | null }) {
  const [showWhy, setShowWhy] = useState(false);

  // No training history at all: no card, rather than an empty one explaining
  // that there is nothing to explain.
  if (!status) return null;

  const band = BAND[status.band];
  const quiet = status.band === 'STEADY' || status.band === 'DETRAINING' || status.band === 'UNKNOWN';

  return (
    <section className={`gd-ramp-card gd-ramp-${band.tone}${quiet ? ' gd-ramp-quiet' : ''}`}>
      <div className="gd-ramp-top">
        <span className={`gd-ramp-pill gd-ramp-${band.tone}`}>{band.word}</span>
        <span className="gd-ramp-headline">{status.headline}</span>
        {status.ratio != null && (
          <span className="gd-ramp-ratio" title="Acute:chronic workload ratio — last week's load against your longer-term load">
            {status.ratio.toFixed(2)}
          </span>
        )}
      </div>

      {!quiet && (
        <>
          <p className="gd-ramp-detail">{status.detail}</p>

          <div className="gd-ramp-figures">
            <div className="gd-ramp-figure">
              <span className="gd-ramp-figure-value">{status.ratio != null ? status.ratio.toFixed(2) : '—'}</span>
              <span className="gd-ramp-figure-label">Acute:chronic</span>
            </div>
            <div className="gd-ramp-figure">
              <span className="gd-ramp-figure-value">
                {status.rampPerWeek != null ? signed(status.rampPerWeek) : '—'}
              </span>
              <span className="gd-ramp-figure-label">Fitness, last 7 days</span>
            </div>
            <div className="gd-ramp-figure">
              <span className="gd-ramp-figure-value">
                {status.rampPerWeekAvg != null ? signed(status.rampPerWeekAvg) : '—'}
              </span>
              <span className="gd-ramp-figure-label">Per week, last 4</span>
            </div>
          </div>
        </>
      )}

      <button type="button" className="gd-why-btn gd-ramp-why" onClick={() => setShowWhy((w) => !w)}>
        How solid is this?
      </button>
      {showWhy && (
        <p className="gd-ramp-caveat">
          This divides the load of your last week by the load you have been carrying for months (Fatigue{' '}
          {status.atl} over Fitness {status.ctl}). The idea that above about 1.5 is risky comes from injury
          research in team sports; later reanalyses found the link is much weaker than first reported, partly
          because the two windows overlap by construction, and several attempts to reproduce it failed. It also
          uses this app's own 42-day fitness curve rather than the 28-day window that work used, which reads a
          little higher through a build. Take it as a reason to look at your week, not a verdict on it.
          {status.provisional && ` There are also only ${status.historyDays} days of history here, which is not yet enough for the long-term curve to have settled.`}
        </p>
      )}
    </section>
  );
}
