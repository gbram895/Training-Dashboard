import type { WorkoutType } from '../api/types';

// Lives here rather than beside the activity-list component so non-React code
// (the workout filters) can read the labels without importing a component.

export const TYPE_ICON: Record<WorkoutType, string> = {
  RUN: '🏃',
  RIDE: '🚴',
  SWIM: '🏊',
  STRENGTH: '🏋️',
  WALK: '🚶',
  BADMINTON: '🏸',
  OTHER: '🏅',
};

export const TYPE_LABEL: Record<WorkoutType, string> = {
  RUN: 'Run',
  RIDE: 'Ride',
  SWIM: 'Swim',
  STRENGTH: 'Strength',
  WALK: 'Walk',
  BADMINTON: 'Badminton',
  OTHER: 'Workout',
};
