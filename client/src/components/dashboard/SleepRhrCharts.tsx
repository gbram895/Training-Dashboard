import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyHealthSummary } from '../../api/types';
import { formatDateUTC, formatDuration } from '../../lib/format';
import { STAGE_COLOR, STAGE_LABEL, STAGE_ORDER } from '../../lib/sleep';

/**
 * The sleep chart is stacked by stage rather than a single bar of total
 * hours: two eight-hour nights are not the same night, and the whole point of
 * importing the breakdown is being able to see which one you had.
 *
 * Nights with no breakdown still draw, as one bar in the "unstaged" series,
 * so a gap in stage data reads as a plainer bar rather than as a missing
 * night. Awake time is deliberately not stacked here — it sits outside time
 * asleep, and adding it would make the column say something other than how
 * long the night was.
 */
function SleepRhrCharts({ days }: { days: DailyHealthSummary[] }) {
  const sleepData = days.map((d) => {
    const staged = d.sleepDeepHours != null || d.sleepCoreHours != null || d.sleepRemHours != null;
    return {
      day: formatDateUTC(d.date),
      deep: staged ? (d.sleepDeepHours ?? 0) : null,
      core: staged ? (d.sleepCoreHours ?? 0) : null,
      rem: staged ? (d.sleepRemHours ?? 0) : null,
      unstaged: staged ? null : (d.sleepHours ?? null),
    };
  });
  const rhrData = days.map((d) => ({ day: formatDateUTC(d.date), value: d.restingHeartRate ?? null }));
  const tickInterval = Math.max(0, Math.ceil(days.length / 8) - 1);

  const tooltipStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  };

  return (
    <section className="card">
      <h2>Sleep stages + resting HR</h2>
      <p className="muted health-chart-label">Sleep</p>
      <div style={{ width: '100%', height: 170 }}>
        <ResponsiveContainer>
          <BarChart data={sleepData} margin={{ top: 4, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} interval={tickInterval} />
            <YAxis stroke="var(--text-faint)" fontSize={11} unit="h" />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [
                value == null ? '—' : formatDuration(Number(value) * 60),
                name === 'unstaged' ? 'Sleep' : STAGE_LABEL[name as keyof typeof STAGE_LABEL],
              ]}
            />
            {STAGE_ORDER.filter((stage) => stage !== 'awake').map((stage, index, shown) => (
              <Bar
                key={stage}
                dataKey={stage}
                stackId="sleep"
                fill={STAGE_COLOR[stage]}
                // Only the top of the stack gets the rounded cap.
                radius={index === shown.length - 1 ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
            <Bar
              dataKey="unstaged"
              stackId="sleep"
              fill="var(--text-faint)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="gd-sleep-legend">
        {STAGE_ORDER.filter((stage) => stage !== 'awake').map((stage) => (
          <li key={stage}>
            <span className="gd-sleep-dot" style={{ background: STAGE_COLOR[stage] }} />
            {STAGE_LABEL[stage]}
          </li>
        ))}
      </ul>
      <p className="muted health-chart-label">Resting heart rate</p>
      <div style={{ width: '100%', height: 170 }}>
        <ResponsiveContainer>
          <LineChart data={rhrData} margin={{ top: 4, left: 0, right: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis dataKey="day" stroke="var(--text-faint)" fontSize={11} interval={tickInterval} />
            <YAxis
              stroke="var(--text-faint)"
              fontSize={11}
              unit=" bpm"
              domain={['auto', 'auto']}
              tickCount={4}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [value == null ? '—' : `${Number(value).toFixed(0)} bpm`, 'Resting HR']}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--chart-run)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default memo(SleepRhrCharts);
