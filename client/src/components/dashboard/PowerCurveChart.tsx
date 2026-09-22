import { memo, useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../../api/client';
import type { CurveWindow, PowerCurveReport, PowerCurveRebuildResult } from '../../api/types';
import { formatDateUTC } from '../../lib/format';

/**
 * The power curve: best sustained power over each of a set of durations, for
 * the last three months, the last year and all time.
 *
 * Fitness (CTL) says how much training has been done. This is the only thing
 * in the app that says how good the athlete actually is, and comparing the
 * three windows is what turns it into an answer about direction — a 5-minute
 * best set two years ago and never approached since means something different
 * from one set last week.
 */

const WINDOW_COLOURS: Record<CurveWindow['key'], string> = {
  '90d': 'var(--chart-ride)',
  '365d': 'var(--chart-hrv)',
  all: 'var(--chart-heart-rate)',
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  return Number.isInteger(min) ? `${min}min` : `${min.toFixed(1)}min`;
}

function PowerCurveChart() {
  const [report, setReport] = useState<PowerCurveReport | null>(null);
  const [selected, setSelected] = useState<CurveWindow['key']>('90d');
  const [building, setBuilding] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<PowerCurveReport>('/workouts/power-curve')
      .then(setReport)
      .catch(() => setError('Could not read your rides.'));
  }

  useEffect(load, []);

  /**
   * Walks the backlog a chunk at a time. The server bounds each request, so
   * the loop is what finishes the job — and because every chunk is committed
   * before the next starts, closing the tab halfway only pauses it.
   */
  async function build() {
    setBuilding(true);
    setError(null);
    try {
      let left = Infinity;
      while (left > 0) {
        const result = await apiFetch<PowerCurveRebuildResult>('/workouts/power-curve/rebuild', { method: 'POST' });
        // A chunk that analysed nothing but still reports work left would spin
        // forever — stop and let the athlete try again instead.
        if (result.analysed === 0) break;
        left = result.remaining;
        setRemaining(left);
      }
      load();
    } catch {
      setError('Could not finish reading your rides. Try again.');
    } finally {
      setBuilding(false);
      setRemaining(null);
    }
  }

  if (!report) {
    return (
      <section className="card">
        <div className="card-header-row">
          <h2>Power curve</h2>
        </div>
        <p className="muted">{error ?? 'Reading your rides…'}</p>
      </section>
    );
  }

  const active = report.windows.find((w) => w.key === selected) ?? report.windows[0];
  const hasAnything = report.windows.some((w) => w.efforts.length > 0);

  // One row per duration carrying all three windows, so the lines share an
  // axis and can be read against each other.
  const chartData = report.durationsSec.map((durationSec) => {
    const row: Record<string, number | null> = { durationSec };
    for (const window of report.windows) {
      row[window.key] = window.efforts.find((e) => e.durationSec === durationSec)?.watts ?? null;
    }
    return row;
  });

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Power curve</h2>
        {report.ridesPending > 0 && (
          <button type="button" className="secondary" onClick={build} disabled={building}>
            {building
              ? `Reading rides… ${remaining != null ? `${remaining} left` : ''}`
              : `Analyse ${report.ridesPending} ride${report.ridesPending === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {error && <p className="gd-cal-error">{error}</p>}

      {!hasAnything ? (
        <p className="muted">
          {report.ridesPending > 0
            ? `Your best efforts haven't been read out of your rides yet. Analysing ${report.ridesPending} ride${
                report.ridesPending === 1 ? '' : 's'
              } fills this in — it only has to happen once.`
            : 'No rides with power data yet, so there is nothing to draw a curve from.'}
        </p>
      ) : (
        <>
          <div className="pc-window-tabs" role="tablist" aria-label="Power curve window">
            {report.windows.map((window) => (
              <button
                key={window.key}
                type="button"
                role="tab"
                aria-selected={window.key === selected}
                className={`pc-window-tab${window.key === selected ? ' is-active' : ''}`}
                onClick={() => setSelected(window.key)}
              >
                {window.label}
              </button>
            ))}
          </div>

          <Headlines report={report} window={active} />

          <div className="chart-legend">
            {report.windows.map((window) => (
              <span key={window.key} className="chart-legend-item">
                <span
                  className="chart-legend-line"
                  style={{ borderTopColor: WINDOW_COLOURS[window.key], borderTopStyle: 'solid' }}
                />{' '}
                {window.label}
              </span>
            ))}
          </div>

          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, left: 0, right: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                {/* Log scale, because the durations span 5 seconds to an hour and
                    a linear axis crushes everything under five minutes into the
                    left-hand edge — which is exactly the part with the most shape. */}
                <XAxis
                  dataKey="durationSec"
                  type="number"
                  scale="log"
                  domain={['dataMin', 'dataMax']}
                  ticks={report.durationsSec}
                  tickFormatter={formatDuration}
                  stroke="var(--text-faint)"
                  fontSize={11}
                />
                <YAxis stroke="var(--text-faint)" fontSize={11} domain={['auto', 'auto']} unit=" W" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                  labelFormatter={(value) => `Best ${formatDuration(Number(value))}`}
                  formatter={(value, name) => [
                    value == null ? '—' : `${Math.round(Number(value))} W`,
                    report.windows.find((w) => w.key === name)?.label ?? String(name),
                  ]}
                />
                {report.windows.map((window) => (
                  <Line
                    key={window.key}
                    type="monotone"
                    dataKey={window.key}
                    stroke={WINDOW_COLOURS[window.key]}
                    strokeWidth={window.key === selected ? 2.5 : 1.25}
                    dot={{ r: window.key === selected ? 3 : 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <CriticalPowerNote window={active} ftpWatts={report.ftpWatts} />
        </>
      )}

      {hasAnything && report.ridesPending > 0 && (
        <p className="gd-set-note">
          {report.ridesPending} ride{report.ridesPending === 1 ? '' : 's'} still to read — until then this curve is
          drawn from {report.ridesAnalysed} of them.
        </p>
      )}
    </section>
  );
}

/** The four durations Bram asked for, as numbers rather than points on a line. */
function Headlines({ report, window }: { report: PowerCurveReport; window: CurveWindow }) {
  return (
    <div className="workout-stat-tiles pc-headlines">
      {report.headlineDurationsSec.map((durationSec) => {
        const effort = window.efforts.find((e) => e.durationSec === durationSec);
        return (
          <div className="workout-stat" key={durationSec}>
            <span className="workout-stat-value" style={{ color: WINDOW_COLOURS[window.key] }}>
              {effort ? `${effort.watts}` : '—'}
              {effort && <span className="pc-unit">W</span>}
            </span>
            <span className="workout-stat-label">
              {formatDuration(durationSec)}
              {effort && (
                <span className="pc-when">
                  {formatDateUTC(new Date(effort.date), { month: 'short', year: 'numeric' })}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the critical-power fit says, in the terms the athlete cares about: a
 * power they can hold, a reserve above it, and how that compares to the FTP
 * every training-load number in the app is currently scaled by.
 */
function CriticalPowerNote({ window, ftpWatts }: { window: CurveWindow; ftpWatts: number }) {
  const cp = window.criticalPower;

  if (!cp) {
    return (
      <p className="gd-set-note">
        Not enough hard efforts between 2 and 20 minutes in {window.label.toLowerCase()} to model critical power. A
        couple of genuinely maximal efforts at those durations is all it takes.
      </p>
    );
  }

  const gap = cp.cpWatts - ftpWatts;
  const verdict =
    Math.abs(gap) <= 5
      ? `That matches the ${ftpWatts}W your training load is calculated with.`
      : gap > 0
        ? `That is ${gap}W above the ${ftpWatts}W your training load is calculated with — Settings › Calibration is where to change it.`
        : `That is ${Math.abs(gap)}W below the ${ftpWatts}W your training load is calculated with — Settings › Calibration is where to change it.`;

  return (
    <div className="pc-cp">
      <p className="pc-cp-line">
        <strong>Critical power {cp.cpWatts}W</strong> with a {cp.wPrimeKj} kJ reserve above it (W′), fitted to your
        best {cp.durationsUsedSec.map(formatDuration).join(', ')} efforts.
      </p>
      <p className="gd-set-note">
        {verdict}
        {cp.fit < 0.95 && ' The efforts fit the model loosely, so treat it as a rough figure.'}
      </p>
    </div>
  );
}

export default memo(PowerCurveChart);
