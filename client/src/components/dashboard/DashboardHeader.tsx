import type { ReactNode } from 'react';
import type { Goal } from '../../api/types';
import { formatDateUTC } from '../../lib/format';
import Wordmark from '../Wordmark';

export default function DashboardHeader({
  latestDataDate,
  lastSyncedAt,
  goals: _goals,
  syncActions,
}: {
  latestDataDate: string | null;
  lastSyncedAt: string | null;
  goals: Goal[];
  syncActions?: ReactNode;
}) {
  return (
    <header className="dash-header">
      <div className="dash-header-top">
        <h1 className="dash-header-title">
          <Wordmark />
        </h1>
        {syncActions}
      </div>
      <p className="muted dash-header-subtitle">
        {latestDataDate ? `Health data through ${formatDateUTC(latestDataDate)}` : 'No health data synced yet'}
        {lastSyncedAt &&
          ` · Updated ${new Date(lastSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`}
      </p>
    </header>
  );
}
