import type { DailyHealthSummary } from '../../api/types';
import { formatClockTime, formatDateUTC, formatDuration } from '../../lib/format';
import { STAGE_COLOR, STAGE_LABEL, STAGE_ORDER, sleepVerdict, toSleepNight, type SleepStage } from '../../lib/sleep';

/**
 * What last night actually was, rather than only how long it lasted.
 *
 * Apple Health has been sending the stage breakdown all along and the
 * importer used to drop it; this is the view that detail earns. The bar is
 * drawn against time in bed, not time asleep, so the awake slice takes up the
 * width it really did — a night that looks long but was broken reads as
 * broken here.
 *
 * Nights recorded by something that doesn't track stages still show up, with
 * the duration and whatever else came through and no breakdown, rather than
 * disappearing from the dashboard.
 */

function stageWidths(
  stages: Record<SleepStage, number | null>,
  span: number,
): { stage: SleepStage; hours: number; pct: number }[] {
  if (span <= 0) return [];
  return STAGE_ORDER.filter((stage) => (stages[stage] ?? 0) > 0).map((stage) => ({
    stage,
    hours: stages[stage] as number,
    pct: ((stages[stage] as number) / span) * 100,
  }));
}

export default function SleepCard({ days }: { days: DailyHealthSummary[] }) {
  const latest = [...days].reverse().find((d) => d.sleepHours != null && d.sleepHours > 0);
  const night = latest ? toSleepNight(latest) : null;
  if (!night) return null;

  // The most recent night on record is only "last night" if it actually is.
  // A sync that has not run for three days would otherwise present a
  // three-day-old night as this morning's, which is worse than saying
  // nothing — the whole card is about how recovered he is right now.
  const nightsAgo = Math.round(
    (Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${night.date.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
  const heading = nightsAgo <= 1 ? 'Last night' : formatDateUTC(night.date, { weekday: 'long' });

  // The bar spans the whole night, so the segments have to be measured against
  // time in bed rather than time asleep — otherwise the awake slice pushes the
  // total past 100% and the widths all shrink to fit.
  const span = night.inBedHours ?? night.totalHours + (night.stages.awake ?? 0);
  const segments = stageWidths(night.stages, span);

  const clock =
    night.start && night.end ? `${formatClockTime(night.start)} – ${formatClockTime(night.end)}` : null;
  const efficiency = night.efficiency != null ? `${Math.round(night.efficiency * 100)}% asleep` : null;

  return (
    <section className="gd-sleep-card">
      <div className="gd-sleep-head">
        <span className="gd-stat-label">{heading}</span>
        <span className="gd-sleep-total mono">{formatDuration(night.totalHours * 60)}</span>
      </div>

      {segments.length > 0 ? (
        <>
          <div className="gd-sleep-bar" role="img" aria-label="Sleep stages through the night">
            {segments.map((s) => (
              <span
                key={s.stage}
                className="gd-sleep-seg"
                style={{ width: `${s.pct}%`, background: STAGE_COLOR[s.stage] }}
                title={`${STAGE_LABEL[s.stage]} ${formatDuration(s.hours * 60)}`}
              />
            ))}
          </div>

          <ul className="gd-sleep-legend">
            {segments.map((s) => (
              <li key={s.stage}>
                <span className="gd-sleep-dot" style={{ background: STAGE_COLOR[s.stage] }} />
                {STAGE_LABEL[s.stage]}
                <span className="mono">{formatDuration(s.hours * 60)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="gd-sleep-note muted">
          No stage breakdown for this night — it was recorded by something that only reports a total.
        </p>
      )}

      {(clock || efficiency) && (
        <p className="gd-sleep-note">{[clock, efficiency].filter(Boolean).join(' · ')}</p>
      )}

      <p className="gd-sleep-verdict">{sleepVerdict(night)}</p>

      {(night.wristTempC != null || night.respiratoryRate != null) && (
        <p className="gd-sleep-note muted">
          {[
            night.wristTempC != null ? `Wrist ${night.wristTempC.toFixed(1)}°C` : null,
            night.respiratoryRate != null ? `${night.respiratoryRate.toFixed(1)} breaths/min` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
