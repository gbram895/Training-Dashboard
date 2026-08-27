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
  hrZone1Min?: number | null;
  hrZone2Min?: number | null;
  hrZone3Min?: number | null;
  hrZone4Min?: number | null;
  hrZone5Min?: number | null;
}

export interface DisciplineTotals {
  distanceKm: number;
  durationMin: number;
}

export interface DisciplineStats {
  allTime: { RUN: DisciplineTotals; RIDE: DisciplineTotals; SWIM: DisciplineTotals };
  weekly: ({ weekStart: string } & { RUN: DisciplineTotals; RIDE: DisciplineTotals; SWIM: DisciplineTotals })[];
}

export interface HrZoneWeek {
  weekStart: string;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export interface HrZoneSettings {
  hrZone1Max: number;
  hrZone2Max: number;
  hrZone3Max: number;
  hrZone4Max: number;
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
  avgHrv?: number | null;
  avgBloodOxygen?: number | null;
}

export interface DropboxSyncStatus {
  configured: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
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
