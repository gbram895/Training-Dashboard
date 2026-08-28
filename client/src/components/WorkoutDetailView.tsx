import type { LibraryWorkout, SelectedWorkout, ThresholdSettings } from '../api/types';
import { formatDuration } from '../lib/format';
import { getTrainingZone } from '../lib/trainingZones';
import BarScale from './BarScale';
import WorkoutProfileChart from './WorkoutProfileChart';

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function WorkoutDetailView({
  workout,
  thresholds,
  isSelected,
  selecting,
  onBack,
  onSelect,
}: {
  workout: LibraryWorkout | SelectedWorkout;
  thresholds: ThresholdSettings | null;
  isSelected: boolean;
  selecting: boolean;
  onBack: () => void;
  onSelect: () => void;
}) {
  const segments = workout.segments ?? [];

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
            const minutes = Math.round(segment.durationSec / 60);
            if (segment.intensityFraction == null) {
              return (
                <div key={i} className="workout-segment-card workout-segment-card-plain">
                  <span className="workout-segment-card-title">Free</span>
                  <span className="workout-segment-card-value">
                    {minutes} <small>min</small>
                  </span>
                </div>
              );
            }

            const zone = getTrainingZone(segment.intensityFraction);
            const low = segment.intensityLow ?? segment.intensityFraction;
            const high = segment.intensityHigh ?? segment.intensityFraction;
            const hasThresholds =
              workout.discipline === 'BIKE' ? (thresholds?.ftpWatts ?? 0) > 0 : (thresholds?.thresholdPaceSecPerKm ?? 0) > 0;

            const onLight = zone.textColor !== '#fff';
            return (
              <div
                key={i}
                className={`workout-segment-card${onLight ? ' workout-segment-card-on-light' : ''}`}
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
                      {minutes} <small>min</small>
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

      <button type="button" className={isSelected ? 'secondary' : ''} disabled={selecting} onClick={onSelect}>
        {isSelected ? 'Selected as today’s workout ✓' : 'Set as today’s workout'}
      </button>
    </div>
  );
}
