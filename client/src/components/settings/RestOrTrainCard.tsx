import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { formatTimeAgo } from '../../lib/format';

export interface IntervalsStatus {
  connected: boolean;
  athleteId: string | null;
  planSource: 'GRADIENT' | 'INTERVALS';
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  lastSyncError: string | null;
  lastEventCount: number | null;
}

// Rest or Train builds the plan and sends it to Intervals.icu; Gradient reads
// it from there. This card links the Intervals.icu account and switches the
// Plan tab between Rest or Train's plan and Gradient's own.
export default function RestOrTrainCard() {
  const [status, setStatus] = useState<IntervalsStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    apiFetch<IntervalsStatus>('/intervals/connection')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function run(path: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<IntervalsStatus>(path, init);
      setStatus(next);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    const ok = await run('/intervals/connection', {
      method: 'POST',
      body: JSON.stringify({ apiKey, athleteId: athleteId || undefined }),
    });
    if (ok) {
      setApiKey('');
      setEditing(false);
    }
  }

  if (!status) return null;
  const following = status.connected && status.planSource === 'INTERVALS';

  return (
    <section className="gd-set-card">
      <h2>Rest or Train plan</h2>
      {status.connected && !editing ? (
        <>
          <p className="muted">
            {following
              ? 'The Plan tab shows the workouts Rest or Train sends to your Intervals.icu calendar, as planned. Gradient only warns when your readiness says a session is too hard.'
              : 'Intervals.icu is linked, but the Plan tab is using Gradient’s own plan.'}
          </p>
          <p className="gd-set-note">
            {status.lastSyncError ? (
              <span className="gd-set-danger">{status.lastSyncError}</span>
            ) : status.lastSyncedAt ? (
              <>
                Checked {formatTimeAgo(status.lastSyncedAt)}
                {status.lastEventCount != null &&
                  ` · ${status.lastEventCount} ${status.lastEventCount === 1 ? 'workout' : 'workouts'} in the next two weeks`}
              </>
            ) : (
              'Not checked yet.'
            )}
          </p>
          {error && <p className="gd-set-note gd-set-danger">{error}</p>}
          <button
            type="button"
            className="gd-set-save"
            disabled={busy}
            onClick={() =>
              following
                ? run('/intervals/sync', { method: 'POST' })
                : run('/intervals/source', { method: 'PUT', body: JSON.stringify({ planSource: 'INTERVALS' }) })
            }
          >
            {busy ? 'Working…' : following ? 'Check now' : 'Follow Rest or Train'}
          </button>
          <div className="gd-set-links">
            {following && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run('/intervals/source', { method: 'PUT', body: JSON.stringify({ planSource: 'GRADIENT' }) })}
              >
                Use Gradient&apos;s own plan
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>
              Change key
            </button>
            <button type="button" disabled={busy} onClick={() => run('/intervals/connection', { method: 'DELETE' })}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={connect}>
          <p className="muted">
            In Rest or Train, turn on sending workouts to Intervals.icu. Then paste your Intervals.icu API key here
            (intervals.icu, Settings, Developer Settings). Gradient will follow that plan instead of building its own.
          </p>
          <div className="gd-set-list">
            <div className="gd-set-row">
              <span className="gd-set-label">API key</span>
              <input
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                className="gd-set-input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="gd-set-row">
              <span className="gd-set-label">Athlete id</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="optional"
                className="gd-set-input"
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="gd-set-note gd-set-danger">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="gd-set-save" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect Intervals.icu'}
            </button>
            {status.connected && (
              <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
