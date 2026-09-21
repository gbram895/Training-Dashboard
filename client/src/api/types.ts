export type WorkoutType = 'RUN' | 'RIDE' | 'STRENGTH' | 'SWIM' | 'WALK' | 'BADMINTON' | 'OTHER';

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
  exercises?: ExerciseEntry[];
  hrZone1Min?: number | null;
  hrZone2Min?: number | null;
  hrZone3Min?: number | null;
  hrZone4Min?: number | null;
  hrZone5Min?: number | null;
  calorieKcal?: number | null;
  kilojoules?: number | null;
  tss?: number | null;
  avgPowerWatts?: number | null;
  normalizedPowerWatts?: number | null;
  rpe?: number | null;
  feedbackNotes?: string | null;
}

export interface FitnessPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface WorkoutSample {
  offsetSec: number;
  heartRate?: number | null;
  speedMps?: number | null;
  powerWatts?: number | null;
}

export type PlannedDiscipline = 'BIKE' | 'RUN';
export type WorkoutCategory = 'ENDURANCE' | 'TEMPO' | 'THRESHOLD' | 'VO2MAX';

export interface WorkoutProfileSegment {
  durationSec: number;
  intensityFraction?: number;
  intensityLow?: number;
  intensityHigh?: number;
  role?: 'warmup' | 'cooldown';
}

export interface LibraryWorkout {
  path: string;
  name: string;
  discipline: PlannedDiscipline;
  durationMin?: number;
  intensity?: number;
  trainingStress?: number;
  profile?: string;
  segments?: WorkoutProfileSegment[];
  category?: WorkoutCategory;
}

export interface SelectedWorkout {
  id: string;
  name: string;
  discipline: PlannedDiscipline;
  durationMin: number | null;
  intensity: number | null;
  trainingStress: number | null;
  profile: string | null;
  sourcePath: string;
  segments: WorkoutProfileSegment[] | null;
  selectedAt: string;
}

export interface TrainingPlanConfig {
  id: string;
  weeklyHours: number;
  mondayHours: number;
  tuesdayHours: number;
  wednesdayHours: number;
  thursdayHours: number;
  fridayHours: number;
  saturdayHours: number;
  sundayHours: number;
  includeRunning: boolean;
  runDays: number[];
}

export interface PlannedDay {
  id: string;
  date: string;
  isRestDay: boolean;
  restReason?: string | null;
  sourcePath?: string | null;
  name?: string | null;
  discipline?: PlannedDiscipline | null;
  durationMin?: number | null;
  intensity?: number | null;
  trainingStress?: number | null;
  profile?: string | null;
  segments?: WorkoutProfileSegment[] | null;
  category?: WorkoutCategory | null;
  availableHoursOverride?: number | null;
  manualOverride?: boolean;
}

export interface DisciplineTotals {
  distanceKm: number;
  durationMin: number;
}

export interface DisciplineStats {
  yearly: { RUN: DisciplineTotals; RIDE: DisciplineTotals; SWIM: DisciplineTotals };
  badmintonHours: number;
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

export interface ThresholdSettings {
  ftpWatts: number;
  thresholdPaceSecPerKm: number;
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
  notes?: string | null;
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

/**
 * What every sync source reports about itself. `lastSyncedAt` moves only when
 * a run succeeds while `lastAttemptedAt` moves on every run, so the pair says
 * both how fresh the data is and whether the most recent run failed — see
 * deriveSyncState in lib/syncHealth.
 */
export interface SyncStatusBase {
  connected: boolean;
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  lastSyncError: string | null;
}

export interface DropboxSyncStatus extends SyncStatusBase {
  configured: boolean;
}

export type GarminSyncStatus = SyncStatusBase;

export interface StravaSyncStatus extends SyncStatusBase {
  configured: boolean;
}

/**
 * The reply from each provider's `sync-now` route. A normal sync is awaited
 * server-side and comes back with what it imported; a force backfill is too
 * long to hold a request open for, so it answers `completed: false` and runs on.
 */
export interface SyncNowResult {
  started: boolean;
  completed: boolean;
  workoutsImported?: number;
  daysImported?: number;
  activitiesSeen?: number;
  activitiesDegraded?: number;
  filesProcessed?: number;
  filesFailed?: number;
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
