import type { Goal } from '../../api/types';
import { formatDateUTC } from '../../lib/format';

function nearestUpcomingGoal(goals: Goal[]): Goal | null {
  const now = Date.now();
  const upcoming = goals
    .filter((g) => g.deadline && new Date(g.deadline).getTime() > now)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());
  return upcoming[0] ?? null;
}

function formatCountdown(deadline: string): string {
  const totalDays = Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000));
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  return `${weeks}w ${days}d`;
}

export default function DashboardHeader({
  latestDataDate,
  lastSyncedAt,
  goals,
}: {
  latestDataDate: string | null;
  lastSyncedAt: string | null;
  goals: Goal[];
}) {
  const raceGoal = nearestUpcomingGoal(goals);

  return (
    <header className="dash-header">
      <div>
        <h1 className="dash-header-title">🏔️🚴🏃 Training Dashboard</h1>
        <p className="muted dash-header-subtitle">
          {latestDataDate ? `Health data through ${formatDateUTC(latestDataDate)}` : 'No health data synced yet'}
          {lastSyncedAt &&
            ` · Updated ${new Date(lastSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
        </p>
      </div>
      {raceGoal && (
        <div className="dash-header-countdown">
          <span className="dash-countdown-value">{formatCountdown(raceGoal.deadline!)}</span>
          <span className="muted dash-countdown-label">until {raceGoal.title}</span>
        </div>
      )}
    </header>
  );
}
