export type WorkoutType = 'RUN' | 'RIDE' | 'STRENGTH' | 'SWIM' | 'WALK' | 'OTHER';

export interface ExerciseEntry {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weightKg?: number | null;
}

export interface Workout {
  id: string;
  type: WorkoutType;
  date: string;
  durationMin: number;
  distanceKm?: number | null;
  notes?: string | null;
  exercises: ExerciseEntry[];
}

export interface WorkoutStats {
  totalWorkouts: number;
  totalDurationMin: number;
  totalDistanceKm: number;
  weeklyBuckets: { weekStart: string; durationMin: number; distanceKm: number; count: number }[];
}

export interface Goal {
  id: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline?: string | null;
}

export interface DailyHealthSummary {
  id: string;
  date: string;
  steps?: number | null;
  distanceKm?: number | null;
  activeEnergyKcal?: number | null;
  avgHeartRate?: number | null;
  restingHeartRate?: number | null;
  sleepHours?: number | null;
  exerciseMinutes?: number | null;
  flightsClimbed?: number | null;
  vo2Max?: number | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
