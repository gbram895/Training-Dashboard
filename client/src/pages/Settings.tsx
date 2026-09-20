import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { HrZoneSettings, ThresholdSettings } from '../api/types';
import ApiTokenCard from '../components/settings/ApiTokenCard';
import PageHead from '../components/PageHead';
import { useAuth } from '../context/AuthContext';

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
  const { user, logout } = useAuth();
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
      <div className="gd-settings-top">
        <PageHead title="Settings" />

        <div className="gd-set-group">
          <p className="gd-set-group-label">Account</p>
          <div className="gd-set-list">
            <div className="gd-set-row">
              <span className="gd-set-label">{user?.name}</span>
              <span className="gd-set-value">{user?.email}</span>
            </div>
            <button type="button" className="gd-set-row" onClick={logout}>
              <span className="gd-set-label gd-set-danger">Log out</span>
            </button>
          </div>
        </div>

        <div className="gd-set-group">
          <p className="gd-set-group-label">Heart rate zones</p>
          <p className="gd-set-note">
            Upper bpm boundary for zones 1–4 (zone 5 is anything above zone 4) — used for time-in-zone breakdowns on
            workouts synced from Apple Health.
          </p>
          {error && <div className="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="gd-set-list">
              <div className="gd-set-row">
                <span className="gd-set-label">Zone 1 max</span>
                <input
                  type="number"
                  required
                  className="gd-set-input"
                  value={zones.hrZone1Max}
                  onChange={(e) => setZones({ ...zones, hrZone1Max: Number(e.target.value) })}
                />
                <span className="gd-set-unit">bpm</span>
              </div>
              <div className="gd-set-row">
                <span className="gd-set-label">Zone 2 max</span>
                <input
                  type="number"
                  required
                  className="gd-set-input"
                  value={zones.hrZone2Max}
                  onChange={(e) => setZones({ ...zones, hrZone2Max: Number(e.target.value) })}
                />
                <span className="gd-set-unit">bpm</span>
              </div>
              <div className="gd-set-row">
                <span className="gd-set-label">Zone 3 max</span>
                <input
                  type="number"
                  required
                  className="gd-set-input"
                  value={zones.hrZone3Max}
                  onChange={(e) => setZones({ ...zones, hrZone3Max: Number(e.target.value) })}
                />
                <span className="gd-set-unit">bpm</span>
              </div>
              <div className="gd-set-row">
                <span className="gd-set-label">Zone 4 max</span>
                <input
                  type="number"
                  required
                  className="gd-set-input"
                  value={zones.hrZone4Max}
                  onChange={(e) => setZones({ ...zones, hrZone4Max: Number(e.target.value) })}
                />
                <span className="gd-set-unit">bpm</span>
              </div>
            </div>
            <button type="submit" className="gd-set-save" disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save zones'}
            </button>
          </form>
        </div>

        <div className="gd-set-group">
          <p className="gd-set-group-label">Training thresholds</p>
          <p className="gd-set-note">
            Used to estimate intensity and training stress for .fit/.zwo files in your workout library, from each
            workout's power or pace targets.
          </p>
          {thresholdError && <div className="alert">{thresholdError}</div>}
          <form onSubmit={handleThresholdSubmit}>
            <div className="gd-set-list">
              <div className="gd-set-row">
                <span className="gd-set-label">FTP</span>
                <input
                  type="number"
                  required
                  min={1}
                  className="gd-set-input"
                  value={thresholds.ftpWatts}
                  onChange={(e) => setThresholds({ ...thresholds, ftpWatts: Number(e.target.value) })}
                />
                <span className="gd-set-unit">watts</span>
              </div>
              <div className="gd-set-row">
                <span className="gd-set-label">Threshold pace</span>
                <input
                  type="text"
                  required
                  placeholder="4:10"
                  className="gd-set-input"
                  value={paceInput}
                  onChange={(e) => setPaceInput(e.target.value)}
                />
                <span className="gd-set-unit">min/km</span>
              </div>
            </div>
            <button type="submit" className="gd-set-save" disabled={thresholdSaving}>
              {thresholdSaving ? 'Saving…' : thresholdSaved ? 'Saved ✓' : 'Save thresholds'}
            </button>
          </form>
        </div>

        <div className="gd-set-group">
          <p className="gd-set-group-label">Garmin & Apple Watch</p>
          <ApiTokenCard />
        </div>
      </div>
    </div>
  );
}
