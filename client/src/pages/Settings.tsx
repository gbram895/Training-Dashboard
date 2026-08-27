import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import type { HrZoneSettings } from '../api/types';

export default function Settings() {
  const [zones, setZones] = useState<HrZoneSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HrZoneSettings>('/settings/hr-zones').then(setZones);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!zones) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<HrZoneSettings>('/settings/hr-zones', {
        method: 'PUT',
        body: JSON.stringify(zones),
      });
      setZones(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Zone thresholds must each be higher than the last.');
    } finally {
      setSaving(false);
    }
  }

  if (!zones) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      <form className="card form" onSubmit={handleSubmit}>
        <h2>Heart rate zones</h2>
        <p className="muted">
          Set the upper bpm boundary for zones 1–4 (zone 5 is anything above zone 4). Used to
          break down time-in-zone for workouts synced from Apple Health.
        </p>
        {error && <div className="alert">{error}</div>}
        <label>
          Zone 1 max (bpm)
          <input
            type="number"
            required
            value={zones.hrZone1Max}
            onChange={(e) => setZones({ ...zones, hrZone1Max: Number(e.target.value) })}
          />
        </label>
        <label>
          Zone 2 max (bpm)
          <input
            type="number"
            required
            value={zones.hrZone2Max}
            onChange={(e) => setZones({ ...zones, hrZone2Max: Number(e.target.value) })}
          />
        </label>
        <label>
          Zone 3 max (bpm)
          <input
            type="number"
            required
            value={zones.hrZone3Max}
            onChange={(e) => setZones({ ...zones, hrZone3Max: Number(e.target.value) })}
          />
        </label>
        <label>
          Zone 4 max (bpm)
          <input
            type="number"
            required
            value={zones.hrZone4Max}
            onChange={(e) => setZones({ ...zones, hrZone4Max: Number(e.target.value) })}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save zones'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Changing these only affects newly-synced workouts. Use "Re-sync all" on the dashboard
          to recompute zones for existing workouts.
        </p>
      </form>
    </div>
  );
}
