import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { HrZoneSettings, ThresholdSettings } from '../api/types';

function paceToString(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function paceToSeconds(value: string): number | null {
  const match = /^(\d+):([0-5]?\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function Settings() {
  const [zones, setZones] = useState<HrZoneSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [thresholds, setThresholds] = useState<ThresholdSettings | null>(null);
  const [paceInput, setPaceInput] = useState('');
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HrZoneSettings>('/settings/hr-zones').then(setZones);
    apiFetch<ThresholdSettings>('/settings/thresholds').then((t) => {
      setThresholds(t);
      setPaceInput(paceToString(t.thresholdPaceSecPerKm));
    });
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

  async function handleThresholdSubmit(e: FormEvent) {
    e.preventDefault();
    if (!thresholds) return;
    const thresholdPaceSecPerKm = paceToSeconds(paceInput);
    if (thresholdPaceSecPerKm == null) {
      setThresholdError('Enter pace as mm:ss, e.g. 4:10');
      return;
    }
    setThresholdSaving(true);
    setThresholdError(null);
    try {
      const updated = await apiFetch<ThresholdSettings>('/settings/thresholds', {
        method: 'PUT',
        body: JSON.stringify({ ftpWatts: thresholds.ftpWatts, thresholdPaceSecPerKm }),
      });
      setThresholds(updated);
      setPaceInput(paceToString(updated.thresholdPaceSecPerKm));
      setThresholdSaved(true);
      setTimeout(() => setThresholdSaved(false), 3000);
    } catch (err) {
      setThresholdError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setThresholdSaving(false);
    }
  }

  if (!zones || !thresholds) return <div className="page">Loading…</div>;

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

      <form className="card form" onSubmit={handleThresholdSubmit}>
        <h2>Training thresholds</h2>
        <p className="muted">
          Used to estimate intensity and training stress for .fit/.zwo files in your workout Plan library, from
          each workout's power or pace targets.
        </p>
        {thresholdError && <div className="alert">{thresholdError}</div>}
        <label>
          FTP (watts)
          <input
            type="number"
            required
            min={1}
            value={thresholds.ftpWatts}
            onChange={(e) => setThresholds({ ...thresholds, ftpWatts: Number(e.target.value) })}
          />
        </label>
        <label>
          Threshold pace (min:sec per km)
          <input
            type="text"
            required
            placeholder="4:10"
            value={paceInput}
            onChange={(e) => setPaceInput(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={thresholdSaving}>
            {thresholdSaving ? 'Saving…' : thresholdSaved ? 'Saved ✓' : 'Save thresholds'}
          </button>
        </div>
      </form>
    </div>
  );
}
