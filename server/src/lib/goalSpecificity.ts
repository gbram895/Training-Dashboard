import type { GoalKind, TrainingTarget } from '@prisma/client';
import { CATEGORY_ORDER, type WorkoutCategory } from './workoutIntensity.js';
import type { PlannedDiscipline } from './workoutLibrary.js';
import type { Phase } from './periodization.js';

/**
 * What a goal actually demands of the athlete, and therefore which sessions
 * belong in the weeks leading up to it.
 *
 * lib/periodization.ts answers "how much" — it scales each day's hours so
 * fitness arrives on the right date. That is only half a plan. A criterium and
 * a 200km gravel day have the same ramp, the same taper and the same recovery,
 * and almost nothing else in common: one is won on repeated efforts well over
 * threshold, the other on being able to ride steadily for eight hours. Before
 * this module the plan trained both identically, because the only thing it
 * knew about a goal was its date.
 *
 * Two things pull against each other here and this module holds both:
 *
 *  - RELEVANCE. Each goal kind has a target mix of session types, and that mix
 *    shifts as the event approaches: everyone does mostly endurance a long way
 *    out, and the event's own demand takes over in the last couple of months.
 *  - VARIETY. The mix is a target to be *converged on*, not a rota. Each day
 *    takes whichever session type is furthest behind its share over the
 *    trailing fortnight, so the week composes itself differently every time
 *    rather than becoming the same seven days on repeat. Fatigue can only
 *    lower the ceiling, never raise it, so a tired week still comes out easy.
 *
 * The athlete's fatigue still has the final say: selectCategory is handed a
 * ceiling derived from Form, HRV, sleep and RPE (see lib/trainingPlan.ts) and
 * never picks above it. Goal specificity decides which session to do among the
 * ones the body can take today — it never argues for a hard day on a flat one.
 *
 * A multisport goal is COMPOSED rather than averaged. A sprint duathlon and a
 * long-course triathlon are both "multisport" and share almost no training:
 * one bike leg is a 20km blast, the other a five-hour ride. So each leg
 * carries its own kind, the day's leg is chosen first, and that leg's own
 * profile picks the session — against that leg's own trailing mix, since a
 * triathlete's bike and run budgets are separate. See legsFor and legForDay.
 */

export type GoalSport = 'BIKE' | 'RUN' | 'BOTH';

/**
 * Where a day sits relative to the goal, which changes what the same goal
 * wants of it. A marathon eight months out and a marathon in three weeks ask
 * for completely different sessions.
 */
export type EmphasisPhase = 'BASE' | 'SPECIFIC' | 'TAPER' | 'RECOVERY';

/** Target share of training days per session type. Each phase's shares sum to 1. */
export type CategoryMix = Record<WorkoutCategory, number>;

export interface GoalProfile {
  kind: GoalKind;
  /** How the athlete would describe it. */
  label: string;
  /** The discipline the event is contested in. */
  sport: GoalSport;
  /** What it asks of them, in one clause — used to explain a day's session. */
  demand: string;
  /**
   * The session type that most characterises the event — the one that, done
   * well, is the reason the athlete goes well on the day. Used to explain a
   * day honestly: a steady ride in the run-up to a criterium is the base under
   * the specific work, not itself specific to repeated surges.
   */
  keyCategory: WorkoutCategory;
  /**
   * Whether one genuinely long session a week is part of preparing for it.
   * For an eight-hour gravel day it is the single most important session of
   * the week; for a 10k it is just a way to be tired on Monday.
   */
  longSessionMatters: boolean;
  mix: Record<EmphasisPhase, CategoryMix>;
}

function mix(endurance: number, tempo: number, threshold: number, vo2max: number): CategoryMix {
  return { ENDURANCE: endurance, TEMPO: tempo, THRESHOLD: threshold, VO2MAX: vo2max };
}

// Everything eases off to steady riding/running in a recovery week or after an
// event, whatever the goal — the point of those days is to absorb the work
// already done, not to train a quality.
const EASY_MIX = mix(0.85, 0.15, 0, 0);
const VERY_EASY_MIX = mix(0.9, 0.1, 0, 0);

/**
 * The library of event types. The numbers are shares of training days, not of
 * hours, and they are deliberately conservative: even the sharpest of these
 * keeps well over a third of the week easy, because the fastest way to stop
 * training for an event is to do every session at race intensity.
 */
const PROFILES: Record<Exclude<GoalKind, 'GENERAL'>, Omit<GoalProfile, 'kind'>> = {
  LONG_RIDE: {
    label: 'Long ride',
    sport: 'BIKE',
    demand: 'hours in the saddle at a pace you can hold all day',
    keyCategory: 'ENDURANCE',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.7, 0.2, 0.1, 0),
      SPECIFIC: mix(0.6, 0.25, 0.15, 0),
      TAPER: mix(0.5, 0.3, 0.2, 0),
      RECOVERY: EASY_MIX,
    },
  },
  HILLY_RIDE: {
    label: 'Hilly ride',
    sport: 'BIKE',
    demand: 'climbing hard, repeatedly, a long way into the day',
    keyCategory: 'THRESHOLD',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.65, 0.2, 0.15, 0),
      SPECIFIC: mix(0.45, 0.2, 0.3, 0.05),
      TAPER: mix(0.45, 0.2, 0.3, 0.05),
      RECOVERY: EASY_MIX,
    },
  },
  RACE_RIDE: {
    label: 'Bunch race or criterium',
    sport: 'BIKE',
    demand: 'repeated hard surges off an already high floor',
    keyCategory: 'VO2MAX',
    longSessionMatters: false,
    mix: {
      BASE: mix(0.6, 0.2, 0.15, 0.05),
      SPECIFIC: mix(0.35, 0.1, 0.25, 0.3),
      TAPER: mix(0.4, 0.1, 0.2, 0.3),
      RECOVERY: EASY_MIX,
    },
  },
  TIME_TRIAL: {
    label: 'Time trial',
    sport: 'BIKE',
    demand: 'one sustained effort right at your limit',
    keyCategory: 'THRESHOLD',
    longSessionMatters: false,
    mix: {
      BASE: mix(0.65, 0.2, 0.15, 0),
      SPECIFIC: mix(0.35, 0.2, 0.45, 0),
      TAPER: mix(0.4, 0.15, 0.45, 0),
      RECOVERY: EASY_MIX,
    },
  },
  GRAVEL_MTB: {
    label: 'Gravel or MTB',
    sport: 'BIKE',
    demand: 'a long day broken up by hard, uneven efforts',
    keyCategory: 'THRESHOLD',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.7, 0.2, 0.1, 0),
      SPECIFIC: mix(0.45, 0.15, 0.25, 0.15),
      TAPER: mix(0.45, 0.15, 0.25, 0.15),
      RECOVERY: EASY_MIX,
    },
  },
  RUN_SHORT: {
    label: '5k or 10k',
    sport: 'RUN',
    demand: 'speed you can hold when it hurts',
    keyCategory: 'VO2MAX',
    longSessionMatters: false,
    mix: {
      BASE: mix(0.65, 0.15, 0.15, 0.05),
      SPECIFIC: mix(0.4, 0.1, 0.25, 0.25),
      TAPER: mix(0.45, 0.1, 0.2, 0.25),
      RECOVERY: EASY_MIX,
    },
  },
  RUN_LONG: {
    label: 'Half or full marathon',
    sport: 'RUN',
    demand: 'holding one pace for a very long way',
    keyCategory: 'THRESHOLD',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.7, 0.2, 0.1, 0),
      SPECIFIC: mix(0.5, 0.25, 0.25, 0),
      TAPER: mix(0.5, 0.25, 0.25, 0),
      RECOVERY: EASY_MIX,
    },
  },
  TRAIL_ULTRA: {
    label: 'Ultra or trail race',
    sport: 'RUN',
    demand: 'time on your feet above everything else',
    keyCategory: 'ENDURANCE',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.8, 0.15, 0.05, 0),
      SPECIFIC: mix(0.7, 0.2, 0.1, 0),
      TAPER: mix(0.7, 0.2, 0.1, 0),
      RECOVERY: VERY_EASY_MIX,
    },
  },
  // A multisport goal is normally composed from its two legs (see legsFor),
  // so this mix is only the fallback for anywhere that asks for a multisport
  // profile without a leg — the label and sport are what get used.
  MULTISPORT: {
    label: 'Triathlon or duathlon',
    sport: 'BOTH',
    demand: 'going well in both disciplines on the same day',
    keyCategory: 'THRESHOLD',
    longSessionMatters: true,
    mix: {
      BASE: mix(0.65, 0.2, 0.15, 0),
      SPECIFIC: mix(0.45, 0.2, 0.3, 0.05),
      TAPER: mix(0.45, 0.2, 0.3, 0.05),
      RECOVERY: EASY_MIX,
    },
  },
};

/**
 * The profile for a goal, or null for GENERAL — "no particular event, keep me
 * fit", which is what every goal was before kinds existed. A null profile
 * means the plan falls back to picking purely on fitness and recovery, exactly
 * as it always did.
 */
export function profileFor(kind: GoalKind): GoalProfile | null {
  if (kind === 'GENERAL') return null;
  const base = PROFILES[kind];
  return base ? { kind, ...base } : null;
}

/** The kinds that can stand as the bike leg of a multisport goal. */
export const BIKE_KINDS: GoalKind[] = ['LONG_RIDE', 'HILLY_RIDE', 'RACE_RIDE', 'TIME_TRIAL', 'GRAVEL_MTB'];
/** The kinds that can stand as the run leg of a multisport goal. */
export const RUN_KINDS: GoalKind[] = ['RUN_SHORT', 'RUN_LONG', 'TRAIL_ULTRA'];

/**
 * What a multisport goal is assumed to be when its legs haven't been set —
 * roughly a middle-distance triathlon, which is the least wrong guess across
 * the range. Goals created before legs existed land here until the athlete
 * says otherwise.
 */
const DEFAULT_BIKE_LEG: GoalKind = 'LONG_RIDE';
const DEFAULT_RUN_LEG: GoalKind = 'RUN_LONG';

export function isBikeKind(kind: GoalKind | null | undefined): boolean {
  return kind != null && BIKE_KINDS.includes(kind);
}

export function isRunKind(kind: GoalKind | null | undefined): boolean {
  return kind != null && RUN_KINDS.includes(kind);
}

/**
 * The profile behind each discipline of a goal.
 *
 * A single-sport goal has one leg and the other is null; a multisport goal has
 * both, each with its own kind, and `composed` says so. Composing beats
 * averaging because the average of a 20km time-trial leg and a marathon leg is
 * a session neither leg wants.
 */
export interface GoalLegs {
  bike: GoalProfile | null;
  run: GoalProfile | null;
  /** True when the goal is contested in both disciplines, each on its own terms. */
  composed: boolean;
}

export type GoalLegSource = Pick<TrainingTarget, 'kind' | 'bikeKind' | 'runKind'>;

export function legsFor(target: GoalLegSource): GoalLegs {
  if (target.kind === 'MULTISPORT') {
    return {
      bike: profileFor(isBikeKind(target.bikeKind) ? target.bikeKind! : DEFAULT_BIKE_LEG),
      run: profileFor(isRunKind(target.runKind) ? target.runKind! : DEFAULT_RUN_LEG),
      composed: true,
    };
  }
  const profile = profileFor(target.kind);
  if (!profile) return { bike: null, run: null, composed: false };
  return {
    bike: profile.sport === 'BIKE' ? profile : null,
    run: profile.sport === 'RUN' ? profile : null,
    composed: false,
  };
}

export interface LegForDayInput {
  legs: GoalLegs;
  /** The athlete's own weekly schedule says this day is a run. */
  scheduledAsRun: boolean;
  includeRunning: boolean;
  isLongDay: boolean;
  /** Training days already given to this goal, so the two legs alternate. */
  disciplineTurns: number;
  /** Week of the plan, so a long ride and a long run take turns week by week. */
  weekIndex: number;
}

/**
 * Which discipline a day of a composed multisport goal is.
 *
 * Decided BEFORE the session type, because for a composed goal the mix depends
 * on which leg the day belongs to — the reverse of a single-sport goal, where
 * one mix covers the week and the discipline follows from how hard the session
 * turned out to be.
 */
export function legForDay(input: LegForDayInput): PlannedDiscipline {
  const { legs, scheduledAsRun, includeRunning, isLongDay, disciplineTurns, weekIndex } = input;
  if (!includeRunning) return 'BIKE';
  if (scheduledAsRun) return 'RUN';

  if (isLongDay) {
    const bikeWantsIt = legs.bike?.longSessionMatters ?? false;
    const runWantsIt = legs.run?.longSessionMatters ?? false;
    // Both legs needing a long session is the normal case for anything past
    // sprint distance, and there is only one long day in the week — so they
    // take it in turns rather than one quietly always winning.
    if (bikeWantsIt && runWantsIt) return weekIndex % 2 === 0 ? 'BIKE' : 'RUN';
    if (bikeWantsIt) return 'BIKE';
    if (runWantsIt) return 'RUN';
  }

  return disciplineTurns % 2 === 0 ? 'BIKE' : 'RUN';
}

export function goalKindLabel(kind: GoalKind): string {
  return kind === 'GENERAL' ? 'No particular event' : (PROFILES[kind]?.label ?? 'Goal');
}

/**
 * How far out the specific work starts. Before this, every goal is trained for
 * the same way — endurance, consistency and a bit of everything — because that
 * is what actually holds up over months. Race-specific intensity has a shelf
 * life of weeks, not seasons, and starting it in January is how people arrive
 * at June already stale.
 */
export const SPECIFIC_WINDOW_DAYS = 56;

export function emphasisFor(phase: Phase | null, daysToEvent: number): EmphasisPhase {
  if (phase === 'TAPER' || phase === 'EVENT') return 'TAPER';
  if (phase === 'RECOVERY' || phase === 'POST_RACE') return 'RECOVERY';
  return daysToEvent > SPECIFIC_WINDOW_DAYS ? 'BASE' : 'SPECIFIC';
}

/**
 * How far back the mix is measured. Two weeks is long enough that a single
 * hard day doesn't swing the shares around, and short enough that the plan
 * responds when the athlete's life changes what they can actually do.
 */
const MIX_WINDOW_DAYS = 14;

/**
 * The most consecutive days that may share a session type. Without this a
 * fatigued athlete — whose ceiling pins to ENDURANCE — gets a fortnight of
 * identical steady rides, which is exactly the "same week on repeat" this is
 * meant to avoid. Two deliberate exceptions get past it: a ceiling that leaves
 * only one option (fatigue wins), and the week's long day for a long event (a
 * steady Saturday into a long Sunday is the shape of the week, not a repeat).
 */
const MAX_CONSECUTIVE_SAME = 2;

export interface CategorySelection {
  category: WorkoutCategory;
  /** True when the goal's mix chose this, false when fatigue left only one option. */
  goalDriven: boolean;
}

export interface SelectCategoryInput {
  /** The hardest session today's Form, HRV, sleep and RPE allow. Never exceeded. */
  ceiling: WorkoutCategory;
  profile: GoalProfile;
  emphasis: EmphasisPhase;
  /** Session types of the recent training days, oldest first, rest days excluded. */
  recent: WorkoutCategory[];
  /** True when this is the week's biggest scheduled day. */
  isLongDay: boolean;
}

/**
 * Which session type today should be: whichever of the goal's demands is
 * furthest behind where it should be, among the ones the athlete can absorb.
 *
 * Converging on a mix rather than following a rota is what makes this both
 * relevant and varied. A rota ("Tuesday is intervals") repeats itself and
 * breaks the moment a day is missed or fatigue forces an easy one. A deficit
 * self-corrects: a week that had to go easy comes back with the quality work
 * it owes, and a week that got its intervals in moves on to something else.
 */
export function selectCategory(input: SelectCategoryInput): CategorySelection {
  const { ceiling, profile, emphasis, recent, isLongDay } = input;

  const ceilingIdx = CATEGORY_ORDER.indexOf(ceiling);
  const allowed = CATEGORY_ORDER.slice(0, ceilingIdx + 1);
  if (allowed.length <= 1) return { category: allowed[0] ?? 'ENDURANCE', goalDriven: false };

  const target = profile.mix[emphasis];

  // The week's longest day belongs to the event when the event is long. Riding
  // intervals on the one day there is time to go long is the classic way to
  // train hard for months and still be unprepared for a six-hour day.
  if (isLongDay && profile.longSessionMatters && target.ENDURANCE > 0) {
    return { category: 'ENDURANCE', goalDriven: true };
  }

  const window = recent.slice(-MIX_WINDOW_DAYS);
  const observed = (c: WorkoutCategory) =>
    window.length === 0 ? 0 : window.filter((x) => x === c).length / window.length;

  // Anything that would be the third day running of the same session type is
  // off the table, unless that would leave nothing at all.
  const tail = window.slice(-MAX_CONSECUTIVE_SAME);
  const wouldRepeat = (c: WorkoutCategory) =>
    tail.length === MAX_CONSECUTIVE_SAME && tail.every((x) => x === c);
  const eligible = allowed.filter((c) => !wouldRepeat(c));
  const pool = eligible.length > 0 ? eligible : allowed;

  // How long since each type was last used, so a tie between two equally-owed
  // types goes to the one the athlete has seen least recently.
  const sinceLastUsed = (c: WorkoutCategory) => {
    const idx = window.lastIndexOf(c);
    return idx === -1 ? Number.POSITIVE_INFINITY : window.length - idx;
  };

  /**
   * Ties are not rare — a profile that wants equal shares of two session types
   * produces one on almost every pick — so how they break matters as much as
   * the deficit itself. Resolving them by position in CATEGORY_ORDER would
   * hand every tie to the easier session, and a 10k leg asking for equal
   * threshold and VO2max would quietly never see a VO2max session.
   *
   * So: least recently used first, then whichever is closest to the event's
   * own session, then the harder of the two — the ceiling has already said
   * the athlete can take it, and freshness spent on the specific work is
   * worth more than freshness spent on a steadier day.
   */
  const keyIdx = CATEGORY_ORDER.indexOf(profile.keyCategory);
  const beatsOnTie = (c: WorkoutCategory, incumbent: WorkoutCategory) => {
    const recency = sinceLastUsed(c) - sinceLastUsed(incumbent);
    if (recency !== 0 && !Number.isNaN(recency)) return recency > 0;
    const specificity =
      Math.abs(CATEGORY_ORDER.indexOf(incumbent) - keyIdx) - Math.abs(CATEGORY_ORDER.indexOf(c) - keyIdx);
    if (specificity !== 0) return specificity > 0;
    return CATEGORY_ORDER.indexOf(c) > CATEGORY_ORDER.indexOf(incumbent);
  };

  let best = pool[0];
  let bestDeficit = target[best] - observed(best);
  for (const c of pool.slice(1)) {
    const deficit = target[c] - observed(c);
    if (deficit > bestDeficit + 1e-9) {
      best = c;
      bestDeficit = deficit;
    } else if (Math.abs(deficit - bestDeficit) <= 1e-9 && beatsOnTie(c, best)) {
      best = c;
      bestDeficit = deficit;
    }
  }

  return { category: best, goalDriven: true };
}

export interface DisciplineInput {
  profile: GoalProfile;
  category: WorkoutCategory;
  isLongDay: boolean;
  /** The athlete's own weekly schedule said this day is a run. */
  scheduledAsRun: boolean;
  includeRunning: boolean;
  /** How many key (threshold/VO2max) sessions have been placed so far in this window. */
  keySessionsSoFar: number;
}

/**
 * Which discipline a day is.
 *
 * The athlete's own weekly schedule (runDays) is never overruled — they said
 * Tuesday is a run, so Tuesday is a run. What the goal adds is specificity
 * where it counts: a run goal claims the sessions that actually prepare you
 * for it — the hard ones and the long one — and leaves the rest of the week as
 * configured, so the cross-training that keeps someone healthy survives.
 *
 * Running is only ever planned when the athlete has running switched on. A run
 * goal with running off is a contradiction the athlete should be told about
 * rather than have quietly resolved for them — see findGoalConflicts.
 */
export function disciplineFor(input: DisciplineInput): PlannedDiscipline {
  const { profile, category, isLongDay, scheduledAsRun, includeRunning, keySessionsSoFar } = input;
  if (!includeRunning) return 'BIKE';
  if (scheduledAsRun) return 'RUN';

  const isKeySession = category === 'THRESHOLD' || category === 'VO2MAX';
  const claimsThisDay = isKeySession || (isLongDay && profile.longSessionMatters);
  if (!claimsThisDay) return 'BIKE';

  if (profile.sport === 'RUN') return 'RUN';
  // Both disciplines have to be sharp for a multisport event, so the key
  // sessions alternate between them rather than one quietly taking them all.
  if (profile.sport === 'BOTH') return keySessionsSoFar % 2 === 1 ? 'RUN' : 'BIKE';
  return 'BIKE';
}

const CATEGORY_PHRASE: Record<WorkoutCategory, string> = {
  ENDURANCE: 'Steady endurance',
  TEMPO: 'Tempo',
  THRESHOLD: 'Threshold work',
  VO2MAX: 'VO2max intervals',
};

/**
 * One line saying why today is this session — shown behind "Why this workout?"
 * on the Plan tab. It names the goal, because "threshold work" means nothing on
 * its own and "threshold work, because Amstel Gold is won on the climbs" is a
 * reason to actually do it.
 */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface FocusLineInput {
  profile: GoalProfile;
  category: WorkoutCategory;
  emphasis: EmphasisPhase;
  goalName: string;
  isLongDay: boolean;
  /**
   * Which leg of a multisport goal this day trains, when the goal is composed.
   * "Threshold work for Ironman Hamburg" is ambiguous when the event has two
   * disciplines; "for Ironman Hamburg's bike leg" is not.
   */
  leg?: PlannedDiscipline | null;
}

export function focusLine(input: FocusLineInput): string {
  const { profile, category, emphasis, isLongDay } = input;
  // Naming the leg where there is one turns the goal's name into the thing the
  // session is actually for, and reads naturally in every sentence below.
  const goalName = input.leg
    ? `${input.goalName}'s ${input.leg === 'RUN' ? 'run' : 'bike'} leg`
    : input.goalName;

  if (isLongDay && profile.longSessionMatters && category === 'ENDURANCE') {
    return `Your long day. ${sentenceCase(profile.demand)} is what ${goalName} comes down to.`;
  }
  switch (emphasis) {
    case 'BASE':
      return `${CATEGORY_PHRASE[category]}, building the base for ${goalName}. The event-specific work starts about eight weeks out.`;
    case 'SPECIFIC': {
      // Only the event's own session gets to claim it's specific. Calling a
      // steady ride "specific to a criterium" would be nonsense, and the
      // athlete would rightly stop trusting the rest of these.
      const here = CATEGORY_ORDER.indexOf(category);
      const key = CATEGORY_ORDER.indexOf(profile.keyCategory);
      if (here === key) return `${CATEGORY_PHRASE[category]} — the session ${goalName} turns on: ${profile.demand}.`;
      if (here < key) return `${CATEGORY_PHRASE[category]} — the base your ${goalName} work is built on.`;
      return `${CATEGORY_PHRASE[category]} — harder than ${goalName} itself asks for, which is what lifts the ceiling on the rest.`;
    }
    case 'TAPER':
      return `${CATEGORY_PHRASE[category]}, sharpening for ${goalName} — short and specific, not tiring.`;
    case 'RECOVERY':
      return `${CATEGORY_PHRASE[category]}, kept easy this week so the work you've done toward ${goalName} sticks.`;
  }
}

/**
 * The goal whose demands a given day is training for.
 *
 * Normally that is the season's anchor — the goal the whole build points at.
 * But a day inside another goal's taper belongs to that goal: there is no
 * sense sharpening for June's ultra in the three days before Saturday's
 * criterium. lib/periodization.ts already works out which goal claimed a day;
 * this just follows it, falling back to the anchor when the goal that claimed
 * the day has no type of its own.
 */
export function goalForDay(
  targets: TrainingTarget[],
  claimedTargetId: string | null,
  anchor: TrainingTarget | null,
): TrainingTarget | null {
  const claimed = claimedTargetId ? (targets.find((t) => t.id === claimedTargetId) ?? null) : null;
  if (claimed && claimed.kind !== 'GENERAL') return claimed;
  if (anchor && anchor.kind !== 'GENERAL') return anchor;
  return claimed ?? anchor;
}
