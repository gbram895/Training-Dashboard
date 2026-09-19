import { useState } from 'react';
import type { LibraryWorkout, SelectedWorkout, ThresholdSettings } from '../api/types';
import { apiFetch, ApiError, getToken } from '../api/client';
import { formatDuration } from '../lib/format';
import { getTrainingZone } from '../lib/trainingZones';
import BarScale from './BarScale';
import WorkoutProfileChart from './WorkoutProfileChart';

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// A 6-second sprint block rounds to "0 min" with a flat durationSec/60 — show
// seconds instead for anything under a minute so short efforts don't vanish.
function formatSegmentDuration(durationSec: number): { value: number; unit: string } {
  if (durationSec < 60) return { value: Math.round(durationSec), unit: 'sec' };
  return { value: Math.round(durationSec / 60), unit: 'min' };
}

export default function WorkoutDetailView({
  workout,
  thresholds,
  isSelected,
  selecting,
  onBack,
  onSelect,
  hideSelectButton,
}: {
  workout: LibraryWorkout | SelectedWorkout;
  thresholds: ThresholdSettings | null;
  isSelected: boolean;
  selecting: boolean;
  onBack: () => void;
  onSelect: () => void;
  hideSelectButton?: boolean;
}) {
  const segments = workout.segments ?? [];
  const workoutPath = 'path' in workout ? workout.path : workout.sourcePath;
  const [garminState, setGarminState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [garminError, setGarminError] = useState<string | null>(null);
  const [fitDownloadError, setFitDownloadError] = useState<string | null>(null);

  // No login, no companion app — for a bike computer that's easier to plug
  // in over USB than to fight Garmin's account login or a Monkey C toolchain
  // with, this just hands over the same .fit file a Garmin Connect–authored
  // workout would produce, to be copied on manually.
  async function downloadFitFile() {
    setFitDownloadError(null);
    try {
      const params = new URLSearchParams({ format: 'fit' });
      if (workoutPath) params.set('path', workoutPath);
      const res = await fetch(`/api/workout-library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new Error(body?.error ?? 'Failed to download workout file');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workout.name.replace(/[^a-z0-9]+/gi, '-')}.fit`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFitDownloadError(err instanceof Error ? err.message : 'Failed to download workout file');
    }
  }

  async function sendToGarmin() {
    setGarminState('sending');
    setGarminError(null);
    try {
      await apiFetch('/health/garmin/push-workout', {
        method: 'POST',
        body: JSON.stringify({ name: workout.name, discipline: workout.discipline, segments }),
      });
      setGarminState('sent');
    } catch (err) {
      setGarminState('error');
      setGarminError(err instanceof ApiError ? err.message : 'Failed to send workout to Garmin');
    }
  }

  return (
    <div className="workout-detail">
      <button type="button" className="secondary plan-back-button" onClick={onBack}>
        ← Back
      </button>

      <div className="workout-card-header">
        <h1 className="workout-detail-title">{workout.name}</h1>
        <span className={`discipline-pill discipline-${workout.discipline.toLowerCase()}`}>
          {workout.discipline === 'BIKE' ? '🚴 Bike' : '🏃 Run'}
        </span>
      </div>

      <div className="workout-stat-tiles">
        <div className="workout-stat">
          <span className="workout-stat-value">
            {workout.durationMin != null ? formatDuration(workout.durationMin) : '—'}
          </span>
          <span className="workout-stat-label">Duration</span>
        </div>
        <div className="workout-stat">
          {workout.trainingStress != null ? (
            <BarScale value={workout.trainingStress} />
          ) : (
            <span className="workout-stat-value">—</span>
          )}
          <span className="workout-stat-label">Training stress</span>
        </div>
        <div className="workout-stat">
          {workout.intensity != null ? <BarScale value={workout.intensity} /> : <span className="workout-stat-value">—</span>}
          <span className="workout-stat-label">Intensity</span>
        </div>
      </div>

      {segments.length > 0 && (
        <>
          <h3 className="workout-profile-heading">Workout Profile</h3>
          <WorkoutProfileChart segments={segments} height={140} />
        </>
      )}

      {workout.profile && <p className="plan-card-profile">{workout.profile}</p>}

      {segments.length > 0 && (
        <div className="workout-segment-list">
          {segments.map((segment, i) => {
            const duration = formatSegmentDuration(segment.durationSec);
            if (segment.intensityFraction == null) {
              return (
                <div key={i} className="workout-segment-card workout-segment-card-plain">
                  <span className="workout-segment-card-title">Free</span>
                  <span className="workout-segment-card-value">
                    {duration.value} <small>{duration.unit}</small>
                  </span>
                </div>
              );
            }

            const zone = getTrainingZone(segment.intensityFraction);
            const low = segment.intensityLow ?? segment.intensityFraction;
            const high = segment.intensityHigh ?? segment.intensityFraction;
            const hasThresholds =
              workout.discipline === 'BIKE' ? (thresholds?.ftpWatts ?? 0) > 0 : (thresholds?.thresholdPaceSecPerKm ?? 0) > 0;

            return (
              <div
                key={i}
                className="workout-segment-card"
                style={{ background: zone.color, color: zone.textColor }}
              >
                <span className="workout-segment-card-title">{zone.label}</span>
                <div className="workout-segment-card-row">
                  <div className="workout-segment-card-stat">
                    <span className="workout-segment-card-value">{zone.rpe}</span>
                    <span className="workout-segment-card-label">RPE</span>
                  </div>
                  <div className="workout-segment-card-stat">
                    <span className="workout-segment-card-value">
                      {duration.value} <small>{duration.unit}</small>
                    </span>
                    <span className="workout-segment-card-label">Duration</span>
                  </div>
                </div>
                <div className="workout-segment-card-divider" />
                <div className="workout-segment-card-row">
                  {hasThresholds && workout.discipline === 'BIKE' && (
                    <div className="workout-segment-card-stat">
                      <span className="workout-segment-card-value">
                        {Math.round(low * thresholds!.ftpWatts)} - {Math.round(high * thresholds!.ftpWatts)}
                      </span>
                      <span className="workout-segment-card-label">Watts</span>
                    </div>
                  )}
                  {hasThresholds && workout.discipline === 'RUN' && (
                    <div className="workout-segment-card-stat">
                      <span className="workout-segment-card-value">
                        {formatPace(thresholds!.thresholdPaceSecPerKm / high)} -{' '}
                        {formatPace(thresholds!.thresholdPaceSecPerKm / low)}
                      </span>
                      <span className="workout-segment-card-label">Pace / km</span>
                    </div>
                  )}
                  <div className="workout-segment-card-stat">
                    <span className="workout-segment-card-value">
                      {Math.round(low * 100)}-{Math.round(high * 100)}%
                    </span>
                    <span className="workout-segment-card-label">{workout.discipline === 'BIKE' ? 'of FTP' : 'of threshold'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {workout.discipline === 'BIKE' && segments.length > 0 && (
        <div className="garmin-push-row">
          <button type="button" className="secondary" onClick={downloadFitFile}>
            Download for bike computer (.fit)
          </button>
          <p className="garmin-push-hint">
            No account login needed — plug your Edge into your computer via USB and copy the downloaded file into
            its <code>GARMIN/Workouts</code> folder.
          </p>
          {fitDownloadError && <p className="garmin-push-error">{fitDownloadError}</p>}
        </div>
      )}

      {workout.discipline === 'BIKE' && segments.length > 0 && (
        <div className="garmin-push-row">
          <button
            type="button"
            className="secondary"
            disabled={garminState === 'sending'}
            onClick={sendToGarmin}
          >
            {garminState === 'sending' ? 'Sending to Garmin…' : garminState === 'sent' ? 'Sent to Garmin ✓' : 'Send to Garmin'}
          </button>
          {garminState === 'error' && <p className="garmin-push-error">{garminError}</p>}
          {garminState === 'sent' && (
            <p className="garmin-push-hint">It’ll show up on your bike computer next time it syncs with Garmin Connect.</p>
          )}
        </div>
      )}

      {!hideSelectButton && (
        <button type="button" className={isSelected ? 'secondary' : ''} disabled={selecting} onClick={onSelect}>
          {isSelected ? 'Selected as today’s workout ✓' : 'Set as today’s workout'}
        </button>
      )}
    </div>
  );
}
