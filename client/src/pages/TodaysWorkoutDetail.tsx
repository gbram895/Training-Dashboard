import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { SelectedWorkout, ThresholdSettings } from '../api/types';
import WorkoutDetailView from '../components/WorkoutDetailView';

export default function TodaysWorkoutDetail() {
  const navigate = useNavigate();
  const [workout, setWorkout] = useState<SelectedWorkout | null | undefined>(undefined);
  const [thresholds, setThresholds] = useState<ThresholdSettings | null>(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setWorkout);
    apiFetch<ThresholdSettings>('/settings/thresholds').then(setThresholds);
  }, []);

  async function reselect() {
    if (!workout) return;
    setSelecting(true);
    try {
      const result = await apiFetch<SelectedWorkout>('/workout-library/select', {
        method: 'POST',
        body: JSON.stringify(workout),
      });
      setWorkout(result);
    } finally {
      setSelecting(false);
    }
  }

  if (workout === undefined) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (workout === null) {
    return (
      <div className="page">
        <button type="button" className="secondary plan-back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <p className="muted">No workout planned for today.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <WorkoutDetailView
        workout={workout}
        thresholds={thresholds}
        isSelected
        selecting={selecting}
        onBack={() => navigate('/')}
        onSelect={reselect}
      />
    </div>
  );
}
