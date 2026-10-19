import type { GoalKind, TrainingLevel } from '@prisma/client';
import {
  bandForIntensity,
  bandingTarget,
  classifyWorkoutCategory,
  estimateIntensityAndStress,
  type WorkoutCategory,
  type WorkoutSegment,
} from './workoutIntensity.js';
import type { ParsedWorkoutFile } from './workoutLibrary.js';

/**
 * The athlete's own training rulebook, turned into code.
 *
 * The rulebook (Bram's "Training Plan Builder: Evidence-Based Rules", kept in
 * the project's shared folder as rulebook/training_plan_rules.md) decides two
 * things the plan used to decide from goal type alone:
 *
 *  - HOW A WEEK'S TIME IS SPLIT between low, moderate and high intensity,
 *    chosen by weekly hours and level. This is a split of TIME, not of days: a
 *    75-minute VO2max ride holds about half an hour of hard work, and counting
 *    it as one "hard day" was what made a day-share mix drift from the
 *    rulebook's percentages.
 *  - WHAT A QUALITY SESSION LOOKS LIKE: its templates (VO-1.., TH-1.., OU-1..),
 *    each with the evidence behind it. A JOIN file that has the same structure
 *    as a template is used in its place; otherwise the session is built here.
 *
 * What it deliberately does not touch, because the rulebook says nothing about
 * them and Bram asked for them to stay: the build ramp, recovery weeks, taper,
 * race days, the fatigue ceiling (Form, HRV, sleep, RPE, ramp rate), and runs.
 *
 * The three zones map onto the app's four session bands as Bram confirmed on
 * 2026-10-19: low = endurance, moderate = tempo and threshold (sweet spot
 * included), high = VO2max and the overs of an over-under.
 */

export type Zone = 'LOW' | 'MODERATE' | 'HIGH';
export type HourBand = 'UNDER_3' | 'H3_6' | 'H6_9' | 'OVER_9';
export type Confidence = 'HIGH' | 'MODERATE' | 'PROVISIONAL';

export interface ZoneSplit {
  LOW: number;
  MODERATE: number;
  HIGH: number;
}

export type IntensityModel = 'HIGH_INTENSITY_LED' | 'MOSTLY_LOW' | 'PYRAMIDAL' | 'POLARIZED';

export interface RulebookStyle {
  band: HourBand;
  level: TrainingLevel;
  model: IntensityModel;
  /**
   * The share of the week's time in each zone. Null where the rulebook reports
   * no split (under 6 hours), and it says the app must not invent one: those
   * bands are planned by counting interval sessions instead.
   */
  split: ZoneSplit | null;
  /**
   * High-intensity sessions a week (VO2max and over-unders together): the
   * target under 6 hours, a ceiling above it.
   */
  highSessionsPerWeek: number;
  confidence: Confidence;
  /** The plan-level confidence note every generated plan must carry (rule 4). */
  note: string;
}

const CONFIDENCE_ORDER: Confidence[] = ['PROVISIONAL', 'MODERATE', 'HIGH'];

export function weakerConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

export function hourBand(weeklyHours: number): HourBand {
  if (weeklyHours < 3) return 'UNDER_3';
  if (weeklyHours < 6) return 'H3_6';
  if (weeklyHours <= 9) return 'H6_9';
  return 'OVER_9';
}

export const HOUR_BAND_LABEL: Record<HourBand, string> = {
  UNDER_3: 'Under 3 h',
  H3_6: '3 to 6 h',
  H6_9: '6 to 9 h',
  OVER_9: 'Over 9 h',
};

export const MODEL_LABEL: Record<IntensityModel, string> = {
  HIGH_INTENSITY_LED: 'High-intensity led',
  MOSTLY_LOW: 'Mostly low, with intervals',
  PYRAMIDAL: 'Pyramidal',
  POLARIZED: 'Polarized',
};

// "Style ratios by weekly hours". The 60/30/10 row is the prescribed split of
// one 16-week study of 14 recreational cyclists; the rulebook's own Known gaps
// say it is unverified, and Bram chose to use it anyway, flagged provisional.
const PYRAMIDAL_SPLIT: ZoneSplit = { LOW: 0.6, MODERATE: 0.3, HIGH: 0.1 };
const POLARIZED_SPLIT: ZoneSplit = { LOW: 0.8, MODERATE: 0, HIGH: 0.2 };

/**
 * A recovery week is still a recovery week (Bram, 2026-10-19: those stay as
 * they are), so it stays easy rather than taking the band's split. Its old 15%
 * of tempo days has no rulebook template to fill it (the moderate ones are
 * sweet spot, which is harder), so it is all low.
 */
export const RECOVERY_SPLIT: ZoneSplit = { LOW: 1, MODERATE: 0, HIGH: 0 };

// V1 asks for two to three VO2max sessions a week, week design for one or two
// beside one or two threshold sessions. The week design is the rule about
// combining them, so above 6 hours it is the cap: two high, two threshold.
// Without it a 60/30/10 week at 11 hours, chased minute by minute, put a
// quality session on six days out of seven.
const MAX_HIGH_SESSIONS = 2;

export function rulebookStyle(weeklyHours: number, level: TrainingLevel): RulebookStyle {
  const band = hourBand(weeklyHours);
  switch (band) {
    case 'UNDER_3':
      return {
        band,
        level,
        model: 'HIGH_INTENSITY_LED',
        split: null,
        highSessionsPerWeek: 2,
        confidence: 'PROVISIONAL',
        note:
          'Provisional: under 3 hours a week rests on a two-week study of young men and a beginner cohort, ' +
          'so treat this plan as lower-confidence.',
      };
    case 'H3_6':
      return {
        band,
        level,
        model: 'MOSTLY_LOW',
        split: null,
        // "Plan 2 to 3 sessions per week": the third once there is room for it.
        highSessionsPerWeek: weeklyHours >= 5 ? 3 : 2,
        confidence: 'MODERATE',
        note:
          'Moderate: one 7-week randomized trial in recreational cyclists (4 × 8 min). ' +
          'No time split is reported for this band, so the plan counts interval sessions instead.',
      };
    case 'H6_9':
    case 'OVER_9': {
      const polarized = level === 'COMPETITIVE';
      const over9 =
        band === 'OVER_9' ? ' Over 9 hours keeps the same split: extra volume did not add gains in trained cyclists.' : '';
      return {
        band,
        level,
        model: polarized ? 'POLARIZED' : 'PYRAMIDAL',
        split: polarized ? POLARIZED_SPLIT : PYRAMIDAL_SPLIT,
        highSessionsPerWeek: MAX_HIGH_SESSIONS,
        confidence: 'MODERATE',
        note:
          (polarized
            ? 'Moderate: competitive athletes may gain more VO2max from polarized training (2025 network meta-analysis); ' +
              'the 80/0/20 split comes from one 6.4 h/week crossover trial.'
            : 'Moderate for the direction: recreational athletes gained more VO2max from pyramidal training ' +
              '(2025 network meta-analysis). The 60/30/10 split is provisional, from one 14-rider study.') + over9,
      };
    }
  }
}

/**
 * The gap the rulebook asks every plan to show: no study says whether quality
 * work belongs early in a build or close to the peak (V7, T9, BB4).
 */
export const TIMING_GAP =
  'No study compares this work early in a build with close to peak fitness, so the plan places it evenly.';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateKind = 'VO2MAX' | 'THRESHOLD' | 'OVER_UNDER' | 'SPRINT';

export interface RulebookTemplate {
  id: string;
  /** How it reads on the plan, e.g. "4 × 8 min VO2max". */
  name: string;
  kind: TemplateKind;
  /** The rulebook zone the session is planned as. */
  zone: Exclude<Zone, 'LOW'>;
  evidence: 'Evidence' | 'Coaching';
  confidence: Confidence;
  /** Where it comes from and who it was tested on, in a sentence. */
  source: string;
  /** What the app had to decide that the rulebook leaves open, if anything. */
  assumption?: string;
  /** The work and recovery between warm-up and cool-down, as fractions of FTP. */
  mainSet: WorkoutSegment[];
}

// Recovery between reps and between intervals is easy spinning. T6 found
// passive recovery lets the work go higher, which on a bike is soft pedalling.
const EASY = 0.5;

function work(sec: number, fraction: number, band = 0.03): WorkoutSegment {
  return {
    durationSec: sec,
    intensityFraction: fraction,
    intensityLow: fraction - band,
    intensityHigh: fraction + band,
    targetMetric: 'power',
  };
}

function easy(sec: number): WorkoutSegment {
  return work(sec, EASY, 0.05);
}

function repeat(times: number, rep: WorkoutSegment[], between: WorkoutSegment[]): WorkoutSegment[] {
  const out: WorkoutSegment[] = [];
  for (let i = 0; i < times; i++) {
    out.push(...rep);
    if (i < times - 1) out.push(...between);
  }
  return out;
}

// One band per app, stated (T3, OU4): sweet spot is 88-94% of FTP, the under of
// an over-under 85% and the over 110%, all from the templates that name them.
const SWEET_SPOT = 0.91;
const SWEET_SPOT_BAND = 0.03;
const UNDER = 0.85;
const OVER = 1.1;
// Above 120% of FTP for 20 to 180 s (FasCat, OU-6).
const ANAEROBIC = 1.25;

// The rulebook prescribes VO-3 at about 90% of max heart rate, and the app
// stores no max heart rate. Bram agreed on converting to % of FTP: 4 × 8 min is
// ridden as the hardest pace held for eight minutes, which is just above
// threshold, and 106% keeps it in the app's VO2max band (> 105%).
const VO3_FRACTION = 1.06;

const TEMPLATES: RulebookTemplate[] = [
  {
    id: 'VO-1',
    name: '13 × 30 s, 3 sets',
    kind: 'VO2MAX',
    zone: 'HIGH',
    evidence: 'Evidence',
    confidence: 'PROVISIONAL',
    source: 'Elite cyclists: short intervals lifted 20-minute power more than long ones (DOI 10.1111/sms.13627).',
    assumption: 'The study rode these effort-matched; 120% of FTP is the app\'s starting target.',
    mainSet: repeat(3, repeat(13, [work(30, 1.2)], [easy(15)]), [easy(180)]),
  },
  {
    id: 'VO-2',
    name: '4 × 5 min VO2max',
    kind: 'VO2MAX',
    zone: 'HIGH',
    evidence: 'Evidence',
    confidence: 'PROVISIONAL',
    source: 'The long-interval group of the same elite study (DOI 10.1111/sms.13627), rotated with VO-1.',
    assumption: '108% of FTP is the app\'s target; the study does not state one.',
    mainSet: repeat(4, [work(300, 1.08)], [easy(150)]),
  },
  {
    id: 'VO-3',
    name: '4 × 8 min VO2max',
    kind: 'VO2MAX',
    zone: 'HIGH',
    evidence: 'Evidence',
    confidence: 'MODERATE',
    source:
      'Recreational cyclists at about 6 h/week: the largest VO2peak gain of three formats, +11.4% ' +
      '(DOI 10.1111/j.1600-0838.2011.01351.x).',
    assumption:
      'Prescribed at about 90% of max heart rate; converted to 106% of FTP, and the recovery between reps ' +
      '(not reported) set to 2 min.',
    mainSet: repeat(4, [work(480, VO3_FRACTION)], [easy(120)]),
  },
  {
    id: 'VO-6',
    name: 'Decreasing intervals, 3 min to 30 s',
    kind: 'VO2MAX',
    zone: 'HIGH',
    evidence: 'Evidence',
    confidence: 'PROVISIONAL',
    source:
      '12 cyclists in single sessions: more time above 90% of VO2peak than fixed-length reps (DOI 10.1007/s00421-020-04463-w). ' +
      'A session variant, not a tested training outcome.',
    assumption: '115% of FTP is the app\'s target, with the steps in between evenly spaced.',
    mainSet: [
      ...[180, 150, 120, 90, 60, 30].flatMap((sec, i, all) => {
        const rest = [120, 100, 80, 60, 40, 20][i];
        return i < all.length - 1 ? [work(sec, 1.15), easy(rest)] : [work(sec, 1.15)];
      }),
    ],
  },
  {
    id: 'SIT',
    name: '6 × 30 s all-out',
    kind: 'SPRINT',
    zone: 'HIGH',
    evidence: 'Evidence',
    confidence: 'PROVISIONAL',
    source:
      'Sprint intervals: about 2.5 h in two weeks matched 10.5 h of endurance training in young, active men ' +
      '(Gibala et al.). Very short study.',
    assumption: 'All-out has no power figure; 150% of FTP is the floor shown, with 4 min easy between.',
    mainSet: repeat(6, [work(30, 1.5, 0.1)], [easy(240)]),
  },
  {
    id: 'TH-1',
    name: '2 × 20 min sweet spot',
    kind: 'THRESHOLD',
    zone: 'MODERATE',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'Coaching guides (Coach Ray, TrainerRoad, biketips): the standard sweet spot session. Not tested in a study.',
    mainSet: repeat(2, [work(1200, SWEET_SPOT, SWEET_SPOT_BAND)], [easy(300)]),
  },
  {
    id: 'TH-3',
    name: '3 × 10 min sweet spot',
    kind: 'THRESHOLD',
    zone: 'MODERATE',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'Coaching guides\' beginner start. Not tested in a study.',
    mainSet: repeat(3, [work(600, SWEET_SPOT, SWEET_SPOT_BAND)], [easy(300)]),
  },
  {
    id: 'TH-4',
    name: '2 × 20 min, 4 min recovery',
    kind: 'THRESHOLD',
    zone: 'MODERATE',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'Coach Ray (Shayne Gaffney\'s sweet spot session), the alternative to TH-1. Not tested in a study.',
    assumption: '"Hard but steady" is ridden in the same 88-94% band as TH-1.',
    mainSet: repeat(2, [work(1200, SWEET_SPOT, SWEET_SPOT_BAND)], [easy(240)]),
  },
  {
    id: 'OU-2',
    name: '3 × 12 min over-unders, 2 min under / 1 min over',
    kind: 'OVER_UNDER',
    zone: 'HIGH',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'Trainright\'s intermediate example. No study tests over-unders in cyclists.',
    mainSet: repeat(3, repeat(4, [work(120, UNDER), work(60, OVER)], []), [easy(360)]),
  },
  {
    id: 'OU-3',
    name: '4 × 6 min over-unders, 85% / 110%',
    kind: 'OVER_UNDER',
    zone: 'HIGH',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'TrainerDay\'s workout library, cadence 85-95 rpm. No study tests over-unders in cyclists.',
    mainSet: repeat(4, repeat(2, [work(120, UNDER), work(60, OVER)], []), [easy(360)]),
  },
  {
    id: 'OU-4',
    name: '4 × 5 min over-unders, 1 min / 1 min',
    kind: 'OVER_UNDER',
    zone: 'HIGH',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'FasCat (a World Tour example), the short variant for time-limited riders. No study tests over-unders in cyclists.',
    // Five minutes alternating, ending on an over (OU5 step 4): over, under, over, under, over.
    mainSet: repeat(4, [work(60, OVER), work(60, UNDER), work(60, OVER), work(60, UNDER), work(60, OVER)], [easy(150)]),
  },
  {
    id: 'OU-5',
    name: '3 × 12 min over-unders, 1 min / 1 min',
    kind: 'OVER_UNDER',
    zone: 'HIGH',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'FasCat\'s advanced example, flagged high demand. No study tests over-unders in cyclists.',
    mainSet: repeat(3, repeat(6, [work(60, UNDER), work(60, OVER)], []), [easy(360)]),
  },
  {
    id: 'OU-6',
    name: '5 × 5 min sweet spot with a 1 min surge',
    kind: 'OVER_UNDER',
    zone: 'HIGH',
    evidence: 'Coaching',
    confidence: 'PROVISIONAL',
    source: 'FasCat\'s intermediate example. No study tests over-unders in cyclists.',
    assumption: 'The surge goes last so each interval ends on an over (OU5), with 2.5 min easy between.',
    mainSet: repeat(5, [work(240, SWEET_SPOT, SWEET_SPOT_BAND), work(60, ANAEROBIC, 0.05)], [easy(150)]),
  },
];

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

const WARM_UP: WorkoutSegment[] = [
  { ...work(300, 0.5, 0.05), role: 'warmup' },
  { ...work(300, 0.6, 0.05), role: 'warmup' },
  { ...work(300, 0.7, 0.05), role: 'warmup' },
];
const COOL_DOWN: WorkoutSegment[] = [{ ...work(600, 0.5, 0.05), role: 'cooldown' }];

// The rulebook's templates specify no warm-up or cool-down. 15 minutes rising to
// 70% and 10 easy minutes are the app's defaults, said so on every session.
export const WARM_UP_NOTE = 'Warm-up (15 min) and cool-down (10 min) are the app\'s defaults; the rulebook gives none.';

function totalSec(segments: WorkoutSegment[]): number {
  return segments.reduce((sum, s) => sum + s.durationSec, 0);
}

/** How long a template is with its warm-up and cool-down, in minutes. */
export function templateMinutes(t: RulebookTemplate): number {
  return Math.round(totalSec([...WARM_UP, ...t.mainSet, ...COOL_DOWN]) / 60);
}

function describeTargets(t: RulebookTemplate, ftpWatts: number): string {
  const watts = (f: number) => `${Math.round(f * ftpWatts)} W`;
  switch (t.kind) {
    case 'THRESHOLD':
      return `Work at 88-94% of FTP (${watts(0.88)}-${watts(0.94)}), cadence above 90 rpm.`;
    case 'OVER_UNDER':
      return t.id === 'OU-6'
        ? `Sweet spot at 88-94% of FTP (${watts(0.88)}-${watts(0.94)}), surges above 120% (${watts(1.2)}+).`
        : `Unders at 85% of FTP (${watts(UNDER)}), overs at 110% (${watts(OVER)}), cadence 85-95 rpm. End each interval on an over.`;
    default: {
      const peak = Math.max(...t.mainSet.map((s) => s.intensityFraction ?? 0));
      return `Reps at ${Math.round(peak * 100)}% of FTP (${watts(peak)}), easy spinning between.`;
    }
  }
}

/** The template as a full session the plan can place, profile chart and Garmin push included. */
export function buildTemplateWorkout(t: RulebookTemplate, ftpWatts: number): ParsedWorkoutFile {
  const segments = [...WARM_UP, ...t.mainSet, ...COOL_DOWN];
  const { intensity, trainingStress } = estimateIntensityAndStress(segments);
  return {
    path: `rulebook:${t.id}`,
    name: `${t.id} · ${t.name}`,
    discipline: 'BIKE',
    durationMin: Math.round(totalSec(segments) / 60),
    intensity,
    trainingStress,
    profile: describeTargets(t, ftpWatts),
    segments,
    category: classifyWorkoutCategory(segments),
  };
}

// Zone 2 is "just below the first lactate threshold" (T7). 65% of FTP is the
// steady riding the app already uses for it (JOIN's "duur").
const STEADY = 0.65;

/** A steady low-intensity ride filling `minutes`, for a low day the library has nothing fresh for. */
export function buildEnduranceRide(minutes: number): ParsedWorkoutFile {
  const total = Math.max(30, Math.round(minutes / 5) * 5);
  const segments: WorkoutSegment[] = [
    { ...work(600, 0.55, 0.05), role: 'warmup' },
    work((total - 15) * 60, STEADY, 0.05),
    { ...work(300, 0.5, 0.05), role: 'cooldown' },
  ];
  const { intensity, trainingStress } = estimateIntensityAndStress(segments);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return {
    path: `rulebook:LOW-${total}`,
    name: `Endurance ride · ${h > 0 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`}`,
    discipline: 'BIKE',
    durationMin: total,
    intensity,
    trainingStress,
    profile: 'Steady at about 65% of FTP: zone 2, just below your first threshold. Conversational the whole way.',
    segments,
    category: 'ENDURANCE',
  };
}

// ---------------------------------------------------------------------------
// Time in zone
// ---------------------------------------------------------------------------

export function zoneForCategory(category: WorkoutCategory): Zone {
  if (category === 'VO2MAX') return 'HIGH';
  if (category === 'ENDURANCE') return 'LOW';
  return 'MODERATE';
}

export function emptyMinutes(): ZoneSplit {
  return { LOW: 0, MODERATE: 0, HIGH: 0 };
}

/**
 * Minutes in each zone a session spends, from its own steps, banded the same
 * way the library's categories are (classifyWorkoutCategory). Steps with no
 * target are counted as low. A session with no steps at all falls back to its
 * category: a share of it in that zone, the rest easy.
 */
export function zoneMinutes(
  segments: WorkoutSegment[] | null | undefined,
  durationMin: number | null | undefined,
  category: WorkoutCategory | null | undefined,
): ZoneSplit {
  const out = emptyMinutes();
  if (segments?.length) {
    for (const s of segments) {
      const zone =
        s.intensityFraction == null
          ? 'LOW'
          : zoneForCategory(bandForIntensity(bandingTarget(s as WorkoutSegment & { intensityFraction: number })));
      out[zone] += s.durationSec / 60;
    }
    return out;
  }
  const minutes = durationMin ?? 0;
  const zone = category ? zoneForCategory(category) : 'LOW';
  const share = zone === 'LOW' ? 1 : 0.3;
  out[zone] += minutes * share;
  out.LOW += minutes * (1 - share);
  return out;
}

export function addMinutes(a: ZoneSplit, b: ZoneSplit): ZoneSplit {
  return { LOW: a.LOW + b.LOW, MODERATE: a.MODERATE + b.MODERATE, HIGH: a.HIGH + b.HIGH };
}

export function sharesOf(m: ZoneSplit): ZoneSplit | null {
  const total = m.LOW + m.MODERATE + m.HIGH;
  if (total <= 0) return null;
  return { LOW: m.LOW / total, MODERATE: m.MODERATE / total, HIGH: m.HIGH / total };
}

function splitError(m: ZoneSplit, target: ZoneSplit): number {
  const s = sharesOf(m);
  if (!s) return 0;
  return (s.LOW - target.LOW) ** 2 + (s.MODERATE - target.MODERATE) ** 2 + (s.HIGH - target.HIGH) ** 2;
}

// ---------------------------------------------------------------------------
// Matching the JOIN library to a template
// ---------------------------------------------------------------------------

interface WorkBlock {
  sec: number;
  meanFraction: number;
  /** Surges above threshold inside the block: what tells a 2/1 over-under from a 1/1. */
  overs: number;
}

/**
 * The work in a session: each unbroken run of steps at or above `floor`, so a
 * set of 4 × 8 min reads as four eight-minute blocks whatever the file calls
 * its steps. An over-under is one block, since its unders sit above the floor.
 */
function workBlocks(segments: WorkoutSegment[], floor: number): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  let sec = 0;
  let weighted = 0;
  let overs = 0;
  let wasOver = false;
  const close = () => {
    if (sec > 0) blocks.push({ sec, meanFraction: weighted / sec, overs });
    sec = 0;
    weighted = 0;
    overs = 0;
    wasOver = false;
  };
  for (const s of segments) {
    const f = s.intensityFraction != null ? bandingTarget(s as WorkoutSegment & { intensityFraction: number }) : null;
    if (f != null && f >= floor && s.role !== 'warmup' && s.role !== 'cooldown') {
      sec += s.durationSec;
      weighted += s.durationSec * f;
      const isOver = f > 1;
      if (isOver && !wasOver) overs++;
      wasOver = isOver;
    } else {
      close();
    }
  }
  close();
  return blocks;
}

const BLOCK_FLOOR: Record<TemplateKind, number> = {
  VO2MAX: 0.98,
  SPRINT: 0.98,
  THRESHOLD: 0.84,
  OVER_UNDER: 0.8,
};

/**
 * Whether a library session is the same workout as a template: the same number
 * of work blocks, each within 15% (or 20 s) of the template's length and within
 * four points of its intensity, and for an over-under the same number of overs. Warm-up, cool-down and any steady riding around
 * the set are free to differ, since that is all a JOIN "– Lang" adds.
 */
export function matchesTemplate(workout: ParsedWorkoutFile, t: RulebookTemplate): boolean {
  if (!workout.segments?.length) return false;
  const floor = BLOCK_FLOOR[t.kind];
  const want = workBlocks(t.mainSet, floor);
  const have = workBlocks(workout.segments, floor);
  if (want.length === 0 || have.length !== want.length) return false;
  return want.every((w, i) => {
    const h = have[i];
    const lengthOk = Math.abs(h.sec - w.sec) <= Math.max(20, w.sec * 0.15);
    const patternOk = t.kind !== 'OVER_UNDER' || h.overs === w.overs;
    return lengthOk && patternOk && Math.abs(h.meanFraction - w.meanFraction) <= 0.04;
  });
}

// ---------------------------------------------------------------------------
// Choosing the day
// ---------------------------------------------------------------------------

/**
 * Which templates a band and level draw on, in order of preference. Where the
 * rulebook names a default it goes first; the rest are its variety options.
 * TH-2 and OU-1 are left out until the plan can tell whether an earlier step
 * was "held cleanly", which their progression depends on.
 */
function templatePool(style: RulebookStyle, zone: Exclude<Zone, 'LOW'>): string[] {
  const competitive = style.level === 'COMPETITIVE';
  if (zone === 'MODERATE') {
    // Under 6 hours the rulebook plans intervals and easy riding only, and a
    // polarized week has no moderate time at all.
    if (style.split == null || style.split.MODERATE === 0) return [];
    return ['TH-1', 'TH-4', 'TH-3'];
  }
  switch (style.band) {
    case 'UNDER_3':
      // Short (about 30 s all-out) or long (4 to 5 min) "depending on the
      // athlete's preference", which the app doesn't ask: they alternate.
      return ['SIT', 'VO-2'];
    case 'H3_6':
      // VO-3 is the default for 3 to 6 hours; OU-2 and OU-3 are the over-unders
      // OU5 names for this band. OU-4 is the short one for a tight day.
      return ['VO-3', 'OU-3', 'OU-2', 'OU-4'];
    default:
      return competitive
        ? // OU-6 is mostly sweet spot, which a polarized week has no room for.
          ['VO-1', 'VO-2', 'VO-6', 'OU-5', 'OU-3', 'OU-4']
        : ['VO-3', 'VO-6', 'OU-3', 'OU-6', 'OU-2', 'OU-4'];
  }
}

/**
 * The goal still has a say in which session fills a slot (Bram: "follow the
 * rulebook but keep the goals in mind"). It only reorders: the rulebook already
 * decided how much of each zone the week gets.
 */
const GOAL_PREFERENCE: Partial<Record<GoalKind, string[]>> = {
  RACE_RIDE: ['VO-1', 'OU-6', 'OU-4', 'VO-6', 'TH-4'],
  TIME_TRIAL: ['VO-3', 'VO-2', 'OU-3', 'TH-1'],
  HILLY_RIDE: ['VO-3', 'OU-3', 'OU-2', 'TH-1'],
  LONG_RIDE: ['TH-1', 'VO-3'],
  GRAVEL_MTB: ['OU-6', 'TH-1', 'VO-3'],
};

export interface RulebookDayHistory {
  date: Date;
  minutes: ZoneSplit;
  /** The session's category, null on a rest day. */
  category: WorkoutCategory | null;
  templateId: string | null;
}

export interface RulebookDayInput {
  date: Date;
  style: RulebookStyle;
  /** The split this day is measured against (the recovery split in a recovery week). */
  split: ZoneSplit | null;
  /** Bike days before this one, oldest first, real plan history then this window. */
  history: RulebookDayHistory[];
  ceiling: WorkoutCategory;
  targetMinutes: number;
  /** The hardest a session may be in length, when a calendar gap caps the day. */
  hardMaxMinutes?: number;
  goalKind: GoalKind | null;
  /** The week's long day for a goal that turns on a long session: always easy (goal kept in mind). */
  longDayForGoal: boolean;
  /** Bike library, warm-ups already removed. */
  library: ParsedWorkoutFile[];
  isFresh: (w: ParsedWorkoutFile) => boolean;
  ftpWatts: number;
  seed: number;
  shuffle: number;
}

export interface RulebookPick {
  zone: Zone;
  /** The template the session is, when it is a quality session. */
  template: RulebookTemplate | null;
  /** The session: a JOIN file when one fits (a template match, or an endurance ride), else one built here. */
  workout: ParsedWorkoutFile;
  fromLibrary: boolean;
  confidence: Confidence;
  confidenceNote: string;
  /** Why this zone today, in a sentence, for the "Why this workout?" line. */
  reason: string;
}

const CATEGORY_RANK: Record<WorkoutCategory, number> = { ENDURANCE: 0, TEMPO: 1, THRESHOLD: 2, VO2MAX: 3 };
const WEEK_DAYS = 7;

function lastWeek(history: RulebookDayHistory[], date: Date): RulebookDayHistory[] {
  const from = date.getTime() - (WEEK_DAYS - 1) * 86_400_000;
  return history.filter((h) => h.date.getTime() >= from && h.date.getTime() < date.getTime());
}

function yesterdayOf(history: RulebookDayHistory[], date: Date): RulebookDayHistory | null {
  const y = date.getTime() - 86_400_000;
  return history.find((h) => h.date.getTime() === y) ?? null;
}

function countTemplates(week: RulebookDayHistory[], kinds: TemplateKind[]): number {
  return week.filter((h) => {
    const t = h.templateId ? TEMPLATE_BY_ID.get(h.templateId) : null;
    return t != null && kinds.includes(t.kind);
  }).length;
}

/** Per-week caps the rulebook sets on each kind of session. */
function underCap(t: RulebookTemplate, week: RulebookDayHistory[]): boolean {
  switch (t.kind) {
    case 'THRESHOLD':
      // TH-1: "at most twice per week".
      return countTemplates(week, ['THRESHOLD']) < 2;
    case 'OVER_UNDER':
      // OU6: one or two over-under sessions a week.
      return countTemplates(week, ['OVER_UNDER']) < 2;
    default:
      return true;
  }
}

/**
 * Week design: VO2max and threshold sessions are kept apart by at least one
 * low-intensity day. The rulebook marks the spacing as coaching practice.
 */
function spacingAllows(zone: Exclude<Zone, 'LOW'>, yesterday: RulebookDayHistory | null): boolean {
  if (!yesterday?.category) return true;
  if (zone === 'HIGH') return yesterday.category !== 'THRESHOLD';
  return yesterday.category !== 'VO2MAX';
}

interface Candidate {
  template: RulebookTemplate;
  workout: ParsedWorkoutFile;
  libraryMatch: ParsedWorkoutFile | null;
}

function lastUsed(history: RulebookDayHistory[], id: string): number {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].templateId === id) return history[i].date.getTime();
  return Number.NEGATIVE_INFINITY;
}

/** Every template that may fill this zone today, best first, each with the session it would be. */
function candidatesFor(zone: Exclude<Zone, 'LOW'>, input: RulebookDayInput, week: RulebookDayHistory[]): Candidate[] {
  const { style, ceiling, targetMinutes, hardMaxMinutes, library, isFresh, ftpWatts, goalKind, history } = input;
  // A session that runs past the day is never planned; the floor of an hour
  // that library picks get is the same allowance here.
  const maxMinutes = Math.min(Math.max(targetMinutes + 10, 60), hardMaxMinutes ?? Infinity);

  const preference = goalKind ? (GOAL_PREFERENCE[goalKind] ?? []) : [];
  const highDone = week.filter((h) => {
    const t = h.templateId ? TEMPLATE_BY_ID.get(h.templateId) : null;
    return t ? t.zone === 'HIGH' : h.category === 'VO2MAX';
  }).length;
  if (zone === 'HIGH' && highDone >= style.highSessionsPerWeek) return [];
  const pool = templatePool(style, zone)
    .map((id) => TEMPLATE_BY_ID.get(id)!)
    .filter((t) => underCap(t, week));

  // Goal-preferred templates first, then the rulebook's own order; within that,
  // whichever was used longest ago, so the same session doesn't come back
  // twice in a week while there are others.
  const rank = (t: RulebookTemplate) => {
    const p = preference.indexOf(t.id);
    return p === -1 ? preference.length + pool.indexOf(t) : p;
  };
  const ordered = [...pool].sort((a, b) => {
    const recent = (t: RulebookTemplate) => (lastUsed(history, t.id) >= input.date.getTime() - WEEK_DAYS * 86_400_000 ? 1 : 0);
    return recent(a) - recent(b) || rank(a) - rank(b);
  });

  const out: Candidate[] = [];
  for (const template of ordered) {
    const built = buildTemplateWorkout(template, ftpWatts);
    if (built.category && CATEGORY_RANK[built.category] > CATEGORY_RANK[ceiling]) continue;
    // "Both": a JOIN file with the template's structure goes first, chosen the
    // same date-seeded way as any library pick so it doesn't change under the
    // athlete between regenerations.
    const matches = library
      .filter((w) => w.durationMin != null && w.durationMin <= maxMinutes && matchesTemplate(w, template))
      .sort((a, b) => a.path.localeCompare(b.path));
    const fresh = matches.filter(isFresh);
    const match = fresh.length ? fresh[input.seed % fresh.length] : null;
    if (match) out.push({ template, workout: match, libraryMatch: match });
    if ((built.durationMin ?? Infinity) <= maxMinutes) out.push({ template, workout: built, libraryMatch: null });
  }
  return out;
}

function lowDay(input: RulebookDayInput): ParsedWorkoutFile {
  const { library, isFresh, targetMinutes, hardMaxMinutes, seed } = input;
  const minutes = Math.min(targetMinutes, hardMaxMinutes ?? Infinity);
  // "Both" holds for easy days too: a fresh JOIN endurance ride of about the
  // right length goes first, and a steady ride is built when there isn't one.
  // The library has very few short endurance rides, which is what kept
  // repeating the same one before.
  const fitting = library
    .filter(
      (w) =>
        w.category === 'ENDURANCE' &&
        w.durationMin != null &&
        w.durationMin <= minutes + 10 &&
        w.durationMin >= minutes - 30 &&
        isFresh(w),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  return fitting.length ? fitting[(seed + input.shuffle) % fitting.length] : buildEnduranceRide(minutes);
}

/** Whether a planned session was built from the rulebook rather than taken from the library. */
export function isGenerated(workout: Pick<ParsedWorkoutFile, 'path'>): boolean {
  return workout.path.startsWith('rulebook:');
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function splitLine(split: ZoneSplit): string {
  return `${pct(split.LOW)} low / ${pct(split.MODERATE)} moderate / ${pct(split.HIGH)} high`;
}

/**
 * What the rulebook makes of one bike day: which zone it trains, which
 * template, and whether a JOIN file or a built session carries it.
 *
 * Over 6 hours the zone is whichever brings the trailing week's time split
 * closest to the target, so the split is converged on rather than dealt out as
 * a rota (the same idea the goal mix used, measured in minutes now). Under 6
 * hours there is no split, and the day is an interval session until the week
 * has its two or three. Either way the fatigue ceiling still has the last word.
 */
export function decideRulebookDay(input: RulebookDayInput): RulebookPick {
  const { style, split, history, date, targetMinutes, longDayForGoal, shuffle } = input;
  const week = lastWeek(history, date);
  const yesterday = yesterdayOf(history, date);

  const low = (reason: string): RulebookPick => {
    const workout = lowDay(input);
    return {
      zone: 'LOW',
      template: null,
      workout,
      fromLibrary: !isGenerated(workout),
      confidence: style.confidence,
      confidenceNote: style.note,
      reason,
    };
  };

  if (longDayForGoal) {
    return low('Your long day stays easy: your goal turns on long hours, and the rulebook\'s split has room for it.');
  }

  const zones: Exclude<Zone, 'LOW'>[] = ['HIGH', 'MODERATE'];
  const options = zones
    .filter((z) => spacingAllows(z, yesterday))
    .map((z) => ({ zone: z, candidates: candidatesFor(z, input, week) }))
    .filter((o) => o.candidates.length > 0);

  let chosen: { zone: Exclude<Zone, 'LOW'>; candidates: Candidate[] } | null = null;
  let reason = '';

  if (split) {
    // Projected time split of the trailing seven days with each option in it.
    const before = week.reduce((m, h) => addMinutes(m, h.minutes), emptyMinutes());
    const asLow = addMinutes(before, { LOW: targetMinutes, MODERATE: 0, HIGH: 0 });
    let best = splitError(asLow, split);
    for (const option of options) {
      const w = option.candidates[0].workout;
      const today = zoneMinutes(w.segments, w.durationMin, w.category);
      // Whatever the session leaves of the day is steady riding (extendToFill).
      const filler = Math.max(0, targetMinutes - (w.durationMin ?? 0));
      const error = splitError(addMinutes(addMinutes(before, today), { LOW: filler, MODERATE: 0, HIGH: 0 }), split);
      if (error < best - 1e-9) {
        best = error;
        chosen = option;
      }
    }
    const observed = sharesOf(before);
    reason = observed
      ? `Your last seven days are ${splitLine(observed)} against the rulebook's ${splitLine(split)}.`
      : `The rulebook's split for your week is ${splitLine(split)}.`;
  } else {
    const done = week.filter((h) => {
      const t = h.templateId ? TEMPLATE_BY_ID.get(h.templateId) : null;
      return t ? t.zone === 'HIGH' : h.category === 'VO2MAX';
    }).length;
    const high = options.find((o) => o.zone === 'HIGH');
    if (high) chosen = high;
    reason =
      `The rulebook plans ${style.highSessionsPerWeek} interval sessions a week at your hours and easy riding for the rest; ` +
      `${done} ${done === 1 ? 'is' : 'are'} already in the last seven days.`;
  }

  if (!chosen) {
    const blocked = !options.some((o) => o.zone === 'HIGH') && yesterday?.category === 'THRESHOLD';
    return low(
      blocked
        ? `${reason} Yesterday was threshold work, and the rulebook keeps a low day before VO2max.`
        : `${reason} An easy day is what the week needs.`,
    );
  }

  // A shuffle steps through the other sessions that could fill the same zone.
  const candidate = chosen.candidates[shuffle % chosen.candidates.length];
  const { template } = candidate;
  const confidence = weakerConfidence(style.confidence, template.confidence);
  const label = template.evidence === 'Coaching' ? 'Coaching guidance, not tested in a study' : 'Evidence';
  const gaps = [
    template.kind === 'OVER_UNDER'
      ? 'No study tests over-unders in cyclists, so its bands and frequency are provisional.'
      : TIMING_GAP,
    template.assumption,
    candidate.libraryMatch ? null : WARM_UP_NOTE,
  ].filter(Boolean);
  return {
    zone: chosen.zone,
    template,
    workout: candidate.workout,
    fromLibrary: candidate.libraryMatch != null,
    confidence,
    confidenceNote: `${template.id}, ${label}: ${template.source} ${gaps.join(' ')}`,
    reason:
      `${reason} ${chosen.zone === 'HIGH' ? 'High' : 'Moderate'} time is what's owed, so today is ${template.id}` +
      (candidate.libraryMatch ? `, using your JOIN session with the same structure.` : '.'),
  };
}


/** Whether the goal's own preference is what put this template first. */
export function goalFavours(goalKind: GoalKind, templateId: string): boolean {
  return GOAL_PREFERENCE[goalKind]?.includes(templateId) ?? false;
}
