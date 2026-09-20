import { useState } from 'react';
import { getToken } from '../../api/client';

// The Apple Watch and Garmin Connect IQ companion apps sign in with this same
// token instead of implementing their own login UI — copy it once into each
// app's settings screen. It's the same JWT already used for this browser
// session, just surfaced so it can be pasted elsewhere.
export default function ApiTokenCard() {
  const [copied, setCopied] = useState(false);
  const token = getToken();

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="gd-set-card">
      <h2>API access</h2>
      <p className="muted">
        Paste this token into the Apple Watch or Garmin Connect IQ companion app's settings so it can sign in as
        you. Treat it like a password — anyone with it can read and change your data.
      </p>
      {token ? (
        <div className="form-actions">
          <button type="button" onClick={copyToken}>
            {copied ? 'Copied ✓' : 'Copy API token'}
          </button>
        </div>
      ) : (
        <p className="muted">Sign in again to generate a token.</p>
      )}
    </section>
  );
}
