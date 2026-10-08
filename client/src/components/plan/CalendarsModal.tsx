import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { CalendarConnectionStatus, CalendarSource } from '../../api/types';
import Sheet, { type SheetDismiss } from '../Sheet';

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Everything about linking the plan to the athlete's own calendar, in both
 * directions: reading their iCloud calendars (and Google/Outlook ones through
 * a private link) so the plan fits around them, and the feed that puts the
 * planned sessions into the iPhone's Calendar app.
 */
export default function CalendarsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const sheet = useRef<SheetDismiss | null>(null);
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showGoogleHelp, setShowGoogleHelp] = useState(false);

  useEffect(() => {
    apiFetch<CalendarConnectionStatus>('/calendar/connection')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your calendars'));
  }, []);

  async function run(label: string, request: () => Promise<CalendarConnectionStatus>) {
    setBusy(label);
    setError(null);
    try {
      setStatus(await request());
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    const ok = await run('connect', () =>
      apiFetch('/calendar/icloud', { method: 'POST', body: JSON.stringify({ appleId, appPassword }) }),
    );
    if (ok) setAppPassword('');
  }

  async function addLink() {
    const ok = await run('link', () => apiFetch('/calendar/links', { method: 'POST', body: JSON.stringify({ url: link }) }));
    if (ok) setLink('');
  }

  function toggle(calendar: CalendarSource) {
    run(calendar.id, () =>
      apiFetch(`/calendar/calendars/${calendar.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !calendar.enabled }),
      }),
    );
  }

  async function copyFeed() {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (an insecure context, or permissions): the link is
      // on screen to copy by hand.
    }
  }

  const icloud = status?.calendars.filter((c) => c.kind === 'caldav') ?? [];
  const links = status?.calendars.filter((c) => c.kind === 'ics') ?? [];
  const webcal = status?.feedUrl.replace(/^https?:\/\//, 'webcal://');

  return (
    <Sheet onClose={onClose} dismissRef={sheet} className="gd-calendars-modal">
      <h2>Calendars</h2>
      <p className="muted">
        Your own events show on the month view, and the plan fits your training around anything marked busy.
        All-day events and events shown as free don't block training.
      </p>

      {error && <div className="alert">{error}</div>}

      <section className="gd-calsrc-section">
        <h3>iPhone calendar (iCloud)</h3>
        {!status ? (
          <p className="muted">Loading…</p>
        ) : status.appleId ? (
          <>
            <p className="gd-calsrc-meta">
              Connected as <strong>{status.appleId}</strong> · read {ago(status.lastSyncedAt)}
            </p>
            {status.lastSyncError && <p className="gd-month-error">{status.lastSyncError}</p>}
            <ul className="gd-calsrc-list">
              {icloud.map((c) => (
                <CalendarRow key={c.id} calendar={c} disabled={busy !== null} onToggle={() => toggle(c)} />
              ))}
            </ul>
            <button
              type="button"
              className="gd-no-time-btn"
              disabled={busy !== null}
              onClick={() => run('disconnect', () => apiFetch('/calendar/icloud', { method: 'DELETE' }))}
            >
              Disconnect iCloud
            </button>
          </>
        ) : (
          <>
            <ol className="gd-calsrc-steps">
              <li>
                Sign in at{' '}
                <a href="https://account.apple.com" target="_blank" rel="noreferrer">
                  account.apple.com
                </a>
              </li>
              <li>Sign-In and Security → App-Specific Passwords → add one called "Gradient"</li>
              <li>Paste it below with your Apple ID</li>
            </ol>
            <p className="gd-calsrc-meta">
              An app-specific password only opens calendar, contacts and mail sync, never your Apple account, and
              you can revoke it there any time.
            </p>
            <label className="gd-calsrc-field">
              <span>Apple ID</span>
              <input
                type="email"
                autoComplete="username"
                value={appleId}
                onChange={(e) => setAppleId(e.target.value)}
                placeholder="you@icloud.com"
              />
            </label>
            <label className="gd-calsrc-field">
              <span>App-specific password</span>
              <input
                type="password"
                autoComplete="off"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
            </label>
            <button type="button" onClick={connect} disabled={busy !== null || !appleId || !appPassword}>
              {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}
      </section>

      <section className="gd-calsrc-section">
        <h3>Google, Outlook and other calendars</h3>
        <p className="gd-calsrc-meta">
          Calendars added on your iPhone from Google or Outlook don't go through iCloud. Add those with their private
          link instead.{' '}
          <button type="button" className="gd-no-time-btn" onClick={() => setShowGoogleHelp((v) => !v)}>
            {showGoogleHelp ? 'Hide how' : 'How?'}
          </button>
        </p>
        {showGoogleHelp && (
          <ul className="gd-calsrc-steps">
            <li>
              Google: on calendar.google.com, open Settings → your calendar → Integrate calendar → copy the{' '}
              <em>Secret address in iCal format</em>
            </li>
            <li>Outlook: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link</li>
          </ul>
        )}
        {links.length > 0 && (
          <ul className="gd-calsrc-list">
            {links.map((c) => (
              <CalendarRow
                key={c.id}
                calendar={c}
                disabled={busy !== null}
                onToggle={() => toggle(c)}
                onRemove={() => run(c.id, () => apiFetch(`/calendar/calendars/${c.id}`, { method: 'DELETE' }))}
              />
            ))}
          </ul>
        )}
        <div className="gd-calsrc-link-row">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://… or webcal://…"
            aria-label="Private calendar link"
          />
          <button type="button" onClick={addLink} disabled={busy !== null || !link.trim()}>
            {busy === 'link' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </section>

      <section className="gd-calsrc-section">
        <h3>Your training in the Calendar app</h3>
        <p className="gd-calsrc-meta">
          Subscribe once and every planned session shows up in your iPhone's Calendar, at its planned time, and keeps
          up as the plan changes.
        </p>
        {status && (
          <>
            <a className="gd-calsrc-subscribe" href={webcal}>
              Add to iPhone Calendar
            </a>
            <button type="button" className="gd-no-time-btn" onClick={copyFeed}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <p className="gd-calsrc-meta">
              Keep this link private: anyone with it can see your planned sessions. Your iPhone checks it on its own
              schedule (the Fetch New Data setting for calendar accounts), so a change can take a little while to
              show there.
            </p>
          </>
        )}
      </section>

      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => sheet.current?.()}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function CalendarRow({
  calendar,
  disabled,
  onToggle,
  onRemove,
}: {
  calendar: CalendarSource;
  disabled: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <li className="gd-calsrc-row">
      <label>
        <input type="checkbox" checked={calendar.enabled} disabled={disabled} onChange={onToggle} />
        <i style={{ background: calendar.color ?? 'var(--text-faint)' }} />
        <span>{calendar.name}</span>
      </label>
      {onRemove && (
        <button type="button" className="gd-no-time-btn" disabled={disabled} onClick={onRemove}>
          Remove
        </button>
      )}
    </li>
  );
}
