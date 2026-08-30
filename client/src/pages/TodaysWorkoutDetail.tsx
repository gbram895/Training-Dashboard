import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import type { LibraryWorkout, PlannedDay, SelectedWorkout, ThresholdSettings } from '../api/types';
import WorkoutDetailView from '../components/WorkoutDetailView';

function plannedDayToLibraryWorkout(day: PlannedDay): LibraryWorkout {
  return {
    path: day.sourcePath ?? '',
    name: day.name ?? 'Workout',
    discipline: day.discipline ?? 'BIKE',
    durationMin: day.durationMin ?? undefined,
    intensity: day.intensity ?? undefined,
    trainingStress: day.trainingStress ?? undefined,
    profile: day.profile ?? undefined,
    segments: day.segments ?? undefined,
    category: day.category ?? undefined,
  };
}

export default function TodaysWorkoutDetail() {
  const navigate = useNavigate();
  const [workout, setWorkout] = useState<SelectedWorkout | null | undefined>(undefined);
  const [plannedToday, setPlannedToday] = useState<PlannedDay | null | undefined>(undefined);
  const [thresholds, setThresholds] = useState<ThresholdSettings | null>(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    apiFetch<SelectedWorkout | null>('/workout-library/selected').then(setWorkout);
    apiFetch<PlannedDay | null>('/training-plan/today').then(setPlannedToday);
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

  async function lockInPlanned() {
    if (!plannedToday) return;
    setSelecting(true);
    try {
      const result = await apiFetch<SelectedWorkout>('/workout-library/select', {
        method: 'POST',
        body: JSON.stringify(plannedDayToLibraryWorkout(plannedToday)),
      });
      setWorkout(result);
    } finally {
      setSelecting(false);
    }
  }

  if (workout === undefined || plannedToday === undefined) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (workout === null && plannedToday?.isRestDay) {
    return (
      <div className="page">
        <button type="button" className="secondary plan-back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <div className="workout-detail">
          <h1 className="workout-detail-title">Rest day 😌</h1>
          <p className="muted">{plannedToday.restReason ?? 'No training scheduled today — recover up.'}</p>
        </div>
      </div>
    );
  }

  if (workout === null && plannedToday) {
    return (
      <div className="page">
        <WorkoutDetailView
          workout={plannedDayToLibraryWorkout(plannedToday)}
          thresholds={thresholds}
          isSelected={false}
          selecting={selecting}
          onBack={() => navigate('/')}
          onSelect={lockInPlanned}
        />
      </div>
    );
  }

  if (workout === null) {
    return (
      <div className="page">
        <button type="button" className="secondary plan-back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <p className="muted">
          No workout planned for today. <Link to="/plan">Pick one from your plan</Link>.
        </p>
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
