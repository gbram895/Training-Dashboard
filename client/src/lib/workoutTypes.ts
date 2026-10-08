import type { WorkoutType } from '../api/types';
import type { IconName } from '../components/Icon';

// Lives here rather than beside the activity-list component so non-React code
// (the workout filters) can read the labels without importing a component.

export const TYPE_ICON: Record<WorkoutType, IconName> = {
  RUN: 'run',
  RIDE: 'ride',
  SWIM: 'swim',
  STRENGTH: 'strength',
  WALK: 'walk',
  BADMINTON: 'badminton',
  OTHER: 'medal',
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

/** The icon for a planned session's discipline. */
export function disciplineIcon(discipline: string | null | undefined): IconName {
  return discipline === 'RUN' ? 'run' : 'ride';
}
