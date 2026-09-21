import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { CalibrationReport, HrZoneValues } from '../../api/types';

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}/km`;
}

function zonesLabel(z: HrZoneValues): string {
  return `${z.hrZone1Max} · ${z.hrZone2Max} · ${z.hrZone3Max} · ${z.hrZone4Max}`;
}

type Which = 'ftp' | 'pace' | 'zones';

/**
 * FTP, threshold pace and heart-rate zones are the denominators of every
 * training-load number in the app — nothing else determines whether Fitness,
 * Form and today's session are right. They used to be set once by hand and
 * never checked again. This compares them against what the athlete's own data
 * says and offers to correct them, one at a time.
 */
export default function CalibrationCard() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [applying, setApplying] = useState<Which | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<CalibrationReport>('/settings/calibration')
      .then(setReport)
      .catch(() => setError('Could not read your training history.'));
  }

  useEffect(load, []);

  async function apply(which: Which, body: Record<string, unknown>, label: string) {
    setApplying(which);
    setError(null);
    try {
      const result = await apiFetch<{ recomputed: number; calibration: CalibrationReport }>(
        '/settings/calibration/apply',
        { method: 'POST', body: JSON.stringify(body) },
      );
      setReport(result.calibration);
      setApplied(`${label} updated — ${result.recomputed} workouts recalculated.`);
    } catch {
      setError('Could not apply that. Try again.');
    } finally {
      setApplying(null);
    }
  }

  if (!report) {
    return (
      <section className="gd-set-card">
        <h2>Calibration</h2>
        <p className="muted">{error ?? 'Reading your recent training…'}</p>
      </section>
    );
  }

  const { ftpWatts, thresholdPaceSecPerKm, hrZones } = report;
  const ftpDiffers = ftpWatts.suggested != null && ftpWatts.suggested !== ftpWatts.current;
  const paceDiffers =
    thresholdPaceSecPerKm.suggested != null && thresholdPaceSecPerKm.suggested !== thresholdPaceSecPerKm.current;
  const zonesDiffer =
    hrZones.suggested != null && zonesLabel(hrZones.suggested) !== zonesLabel(hrZones.current);
  const anythingToDo = ftpDiffers || paceDiffers || zonesDiffer;

  return (
    <section className="gd-set-card">
      <h2>Calibration</h2>
      <p className="muted">
        Every Fitness, Fatigue and Form number is your effort measured against these three. Here's what your
        last {report.windowDays} days say they should be. Accepting one recalculates your whole history.
      </p>

      {applied && <p className="gd-cal-applied">{applied}</p>}
      {error && <p className="gd-cal-error">{error}</p>}

      <div className="gd-cal-list">
        <CalibrationRow
          label="FTP"
          current={`${ftpWatts.current} W`}
          suggested={ftpWatts.suggested != null ? `${ftpWatts.suggested} W` : null}
          basis={ftpWatts.basis}
          differs={ftpDiffers}
          busy={applying === 'ftp'}
          onApply={() => apply('ftp', { ftpWatts: ftpWatts.suggested }, 'FTP')}
        />
        <CalibrationRow
          label="Threshold pace"
          current={formatPace(thresholdPaceSecPerKm.current)}
          suggested={thresholdPaceSecPerKm.suggested != null ? formatPace(thresholdPaceSecPerKm.suggested) : null}
          basis={thresholdPaceSecPerKm.basis}
          differs={paceDiffers}
          busy={applying === 'pace'}
          onApply={() =>
            apply('pace', { thresholdPaceSecPerKm: thresholdPaceSecPerKm.suggested }, 'Threshold pace')
          }
        />
        <CalibrationRow
          label="Heart-rate zones"
          current={zonesLabel(hrZones.current)}
          suggested={hrZones.suggested ? zonesLabel(hrZones.suggested) : null}
          basis={hrZones.basis}
          differs={zonesDiffer}
          busy={applying === 'zones'}
          onApply={() => apply('zones', { hrZones: hrZones.suggested }, 'Heart-rate zones')}
        />
      </div>

      {!anythingToDo && <p className="gd-set-note gd-cal-ok">Everything matches your recent training.</p>}
    </section>
  );
}

function CalibrationRow({
  label,
  current,
  suggested,
  basis,
  differs,
  busy,
  onApply,
}: {
  label: string;
  current: string;
  suggested: string | null;
  basis: string;
  differs: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <div className="gd-cal-row">
      <div className="gd-cal-head">
        <span className="gd-set-label">{label}</span>
        <span className="gd-cal-values mono">
          {current}
          {differs && suggested && (
            <>
              <span className="gd-cal-arrow">→</span>
              <span className="gd-cal-new">{suggested}</span>
            </>
          )}
        </span>
      </div>
      <p className="gd-cal-basis">{basis}</p>
      {differs && (
        <button type="button" className="gd-set-save gd-cal-apply" onClick={onApply} disabled={busy}>
          {busy ? 'Recalculating…' : `Use ${suggested}`}
        </button>
      )}
    </div>
  );
}
