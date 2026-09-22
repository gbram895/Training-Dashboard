export type WorkoutType = 'RUN' | 'RIDE' | 'STRENGTH' | 'SWIM' | 'WALK' | 'BADMINTON' | 'OTHER';

export interface ExerciseEntry {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weightKg?: number | null;
}

// How a workout's training load was measured — power is the most precise,
// heart rate the catch-all that lets non-bike/run sessions count at all.
export type TssSource = 'POWER' | 'PACE' | 'HR';

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
  tssSource?: TssSource | null;
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
  /** Which metric the source file prescribed the segment in. See server/src/lib/workoutIntensity.ts. */
  targetMetric?: 'power' | 'pace' | 'hr';
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
  /** One line on which demand of which goal this session trains. */
  focus?: string | null;
  availableHoursOverride?: number | null;
  manualOverride?: boolean;
  phase?: TrainingPhase | null;
  phaseWeek?: number | null;
  loadMultiplier?: number | null;
}

/**
 * How the session that was actually done measured up against the one the plan
 * asked for that day. Derived server-side on request — see
 * server/src/lib/sessionReview.ts, which explains why this is not a comparison
 * of training-load numbers.
 */
export type SessionGrade = 'NAILED' | 'SOLID' | 'OFF' | 'MISSED' | 'REST_DAY' | 'UNJUDGED';
export type CheckVerdict = 'GOOD' | 'FAIR' | 'POOR';
export type EffortSource = 'POWER' | 'PACE' | 'HR' | 'NONE';
export type ReviewBasis = 'TIME_IN_ZONE' | 'RESTRAINT' | 'INTENSITY' | 'NONE';

export interface SessionCheck {
  key: 'discipline' | 'duration' | 'execution';
  label: string;
  verdict: CheckVerdict;
  planned: string | null;
  actual: string | null;
  note: string;
}

export interface SessionBandMinutes {
  band: WorkoutCategory;
  plannedMin: number | null;
  actualMin: number | null;
}

export interface SessionReview {
  date: string;
  workoutIds: string[];
  planned: {
    name: string | null;
    discipline: PlannedDiscipline | null;
    durationMin: number | null;
    category: WorkoutCategory | null;
    focus: string | null;
    isRestDay: boolean;
    restReason: string | null;
  } | null;
  actual: { types: WorkoutType[]; durationMin: number; tss: number | null; rpe: number | null };
  grade: SessionGrade;
  score: number | null;
  headline: string;
  checks: SessionCheck[];
  bands: SessionBandMinutes[];
  basis: ReviewBasis;
  effortSource: EffortSource;
  notes: string[];
  load: { plannedTss: number | null; actualTss: number | null };
}

export type TrainingPhase = 'BUILD' | 'RECOVERY' | 'TAPER' | 'EVENT' | 'POST_RACE';

/**
 * A = peak for it, B = matters but doesn't reshape the season, C = train
 * through it. Decides how much of the calendar around a goal moves for it.
 */
export type TargetPriority = 'A' | 'B' | 'C';

/**
 * What kind of event a goal is. Priority says how much of the calendar bends
 * for it; this says what the sessions in the run-up actually are — a bunch
 * race and a 200km gravel day need completely different training. GENERAL is
 * "no particular event", which is how every goal behaved before types existed.
 */
export type GoalKind =
  | 'GENERAL'
  | 'LONG_RIDE'
  | 'HILLY_RIDE'
  | 'RACE_RIDE'
  | 'TIME_TRIAL'
  | 'GRAVEL_MTB'
  | 'RUN_SHORT'
  | 'RUN_LONG'
  | 'TRAIL_ULTRA'
  | 'MULTISPORT';

export interface TrainingTarget {
  id: string;
  name: string;
  date: string;
  priority: TargetPriority;
  kind: GoalKind;
  /**
   * For a MULTISPORT goal only: what each leg of it actually is, each training
   * to its own demands. Null on every other kind of goal.
   */
  bikeKind?: GoalKind | null;
  runKind?: GoalKind | null;
  peakCtl?: number | null;
  rampPerWeek: number;
  recoveryEveryNWeeks: number;
  recoveryMultiplier: number;
  taperDays: number;
  taperFloor: number;
  startedOn: string;
}

export interface TrainingTargets {
  targets: TrainingTarget[];
  /** The goal the build is aimed at — the next A goal still ahead. */
  anchorId: string | null;
  /** Plain-language warnings where two goals are asking for incompatible things. */
  conflicts: string[];
}

export interface SeasonWeek {
  weekStart: string;
  phase: TrainingPhase;
  phaseWeek: number;
  loadMultiplier: number;
  projectedCtl: number;
  events: { id: string; name: string; date: string; priority: TargetPriority }[];
}

export interface SeasonOutlook {
  weeks: SeasonWeek[];
  conflicts: string[];
  currentCtl?: number;
}

export type Freshness = 'fresh' | 'neutral' | 'fatigued';

export interface GoalForecast {
  id: string;
  name: string;
  date: string;
  priority: TargetPriority;
  daysAway: number;
  isAnchor: boolean;
  projectedCtl: number;
  ctlDelta: number;
  projectedTsb: number;
  freshness: Freshness;
  peakCtl: number | null;
  meetsPeak: boolean | null;
  buildWeeks: number;
  ftpPotential: PotentialRange | null;
  pacePotential: PotentialRange | null;
}

/** `hold` is already demonstrated; `potential` is the upside from the build weeks. */
export interface PotentialRange {
  hold: number;
  potential: number;
}

export interface FitnessForecast {
  currentCtl: number;
  goals: GoalForecast[];
  currentFtpWatts: number | null;
  currentThresholdPaceSecPerKm: number | null;
  ftpBasis: string;
  paceBasis: string;
}

export interface HrZoneValues {
  hrZone1Max: number;
  hrZone2Max: number;
  hrZone3Max: number;
  hrZone4Max: number;
}

export interface CalibrationSuggestion<T> {
  current: T;
  suggested: T | null;
  basis: string;
}

export interface CalibrationReport {
  windowDays: number;
  ftpWatts: CalibrationSuggestion<number>;
  thresholdPaceSecPerKm: CalibrationSuggestion<number>;
  hrZones: CalibrationSuggestion<HrZoneValues>;
}

export interface ReviewDay {
  date: string;
  planned: {
    isRestDay: boolean;
    name: string | null;
    discipline: PlannedDiscipline | null;
    durationMin: number | null;
    trainingStress: number | null;
    phase: string | null;
  } | null;
  actual: {
    type: WorkoutType;
    durationMin: number;
    distanceKm: number | null;
    tss: number | null;
    tssSource: TssSource | null;
    rpe: number | null;
  }[];
  completed: boolean | null;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  days: ReviewDay[];
  plannedSessions: number;
  completedSessions: number;
  plannedHours: number;
  actualHours: number;
  plannedTss: number;
  actualTss: number;
  byDiscipline: { type: WorkoutType; sessions: number; hours: number; tss: number }[];
  fitness: {
    ctlStart: number | null;
    ctlEnd: number | null;
    ctlDelta: number | null;
    ctlDelta4w: number | null;
    ctlDelta12w: number | null;
    tsbEnd: number | null;
  };
  target: {
    name: string;
    date: string;
    daysToEvent: number;
    priority: TargetPriority;
    phase: string | null;
    phaseWeek: number | null;
    goalsAhead: number;
  } | null;
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
