import { useState } from 'react';
import { apiFetch } from '../../api/client';

// Unlike ApiTokenCard (which reuses the browser's own 30-day session token
// for companion apps that can prompt you to log in again), the widget runs
// unattended on the Home Screen with no way to ask for a fresh token — so
// this mints its own, separately, with a year-long expiry instead.
export default function WidgetTokenCard() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await apiFetch<{ token: string }>('/widget/token', { method: 'POST' });
      setToken(token);
      await navigator.clipboard.writeText(token).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to generate token');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gd-set-card">
      <h2>iPhone Home Screen widget</h2>
      <p className="muted">
        Shows today's suggested training as a Home Screen widget, using the free{' '}
        <strong>Scriptable</strong> app. See <code>ios-widget/README.md</code> in the repo for the one-time setup —
        you'll need this token pasted into the widget script. Treat it like a password: it's good for a year and can
        read and change your data.
      </p>
      <div className="form-actions">
        <button type="button" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : copied ? 'Copied ✓' : 'Generate widget token'}
        </button>
      </div>
      {token && (
        <p className="muted" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85em' }}>
          {token}
        </p>
      )}
      {error && <p className="gd-set-note gd-set-danger">{error}</p>}
    </section>
  );
}
