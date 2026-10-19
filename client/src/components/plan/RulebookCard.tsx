import type { RulebookSummary, ZoneSplit } from '../../api/types';
import { CONFIDENCE_LABEL } from '../../lib/rulebook';

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function SplitBar({ split }: { split: ZoneSplit }) {
  return (
    <span className="gd-rulebook-bar" aria-hidden="true">
      <span className="gd-rulebook-low" style={{ flexGrow: split.LOW }} />
      <span className="gd-rulebook-moderate" style={{ flexGrow: split.MODERATE }} />
      <span className="gd-rulebook-high" style={{ flexGrow: split.HIGH }} />
    </span>
  );
}

/**
 * Which part of the training rulebook the plan is following and how the next
 * seven days measure up against it, with the confidence note the rulebook asks
 * every plan to carry.
 */
export default function RulebookCard({ summary }: { summary: RulebookSummary }) {
  const { split, planned } = summary;
  return (
    <div className="gd-rulebook-card">
      <p className="gd-rulebook-head">
        <span className="gd-rulebook-title">
          {summary.modelLabel} · {summary.bandLabel} a week · {summary.level === 'COMPETITIVE' ? 'Competitive' : 'Recreational'}
        </span>
        <span className={`gd-confidence gd-confidence-${summary.confidence.toLowerCase()}`}>
          {CONFIDENCE_LABEL[summary.confidence]}
        </span>
      </p>

      {split ? (
        <div className="gd-rulebook-rows">
          <div className="gd-rulebook-row">
            <span className="gd-rulebook-label">Rulebook</span>
            <SplitBar split={split} />
            <span className="gd-rulebook-nums mono">
              {pct(split.LOW)} / {pct(split.MODERATE)} / {pct(split.HIGH)}
            </span>
          </div>
          {planned && (
            <div className="gd-rulebook-row">
              <span className="gd-rulebook-label">Next 7 days</span>
              <SplitBar split={planned} />
              <span className="gd-rulebook-nums mono">
                {pct(planned.LOW)} / {pct(planned.MODERATE)} / {pct(planned.HIGH)}
              </span>
            </div>
          )}
          <p className="gd-rulebook-legend">Low / moderate / high, as a share of your bike time</p>
        </div>
      ) : (
        <p className="gd-rulebook-legend">
          {summary.highSessionsPerWeek} interval sessions a week and easy riding for the rest; {summary.plannedHighSessions}{' '}
          planned in the next 7 days.
        </p>
      )}

      <p className="gd-rulebook-note">{summary.note}</p>
    </div>
  );
}
