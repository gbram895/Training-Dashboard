/**
 * Exercises lib/sessionReview.ts's judgement against synthetic sessions.
 *
 * There is no test runner in this repo, and this is logic that tells the
 * athlete he did or did not do his training — being wrong about that is worse
 * than being silent. So the pure half of it (judgeSession) is run here over
 * hand-built power/pace/heart-rate streams whose right answer is known in
 * advance, with no database involved.
 *
 *   cd server && npx tsx scripts/simulate-session-review.ts
 *
 * What it is really checking is the one thing the feature exists for: that a
 * long easy ride standing in for an interval session is called out as a miss
 * even though its training load came out the same.
 */
import { judgeSession, type ReviewPlannedDay, type ReviewWorkout } from '../src/lib/sessionReview.js';
import { computeRideTss, computeRunTss } from '../src/lib/trainingLoad.js';

const FTP = 200;
const THRESHOLD_PACE = 300; // sec/km
const thresholds = {
  ftpWatts: FTP,
  thresholdPaceSecPerKm: THRESHOLD_PACE,
  hrZone1Max: 114,
  hrZone2Max: 133,
  hrZone3Max: 152,
  hrZone4Max: 171,
};

type Block = { min: number; watts?: number; mps?: number };

/** A 1 Hz stream from a list of blocks, with a little noise so the smoothing is doing real work. */
function stream(blocks: Block[]): { offsetSec: number; heartRate: number | null; speedMps: number | null; powerWatts: number | null }[] {
  const samples = [];
  let t = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.min * 60; i++) {
      const jitter = 1 + Math.sin(t / 7) * 0.08;
      samples.push({
        offsetSec: t++,
        heartRate: null,
        speedMps: block.mps != null ? block.mps * jitter : null,
        powerWatts: block.watts != null ? Math.round(block.watts * jitter) : null,
      });
    }
  }
  return samples;
}

function totalMin(blocks: Block[]): number {
  return blocks.reduce((s, b) => s + b.min, 0);
}

function ride(id: string, blocks: Block[], rpe: number | null = null): ReviewWorkout {
  const samples = stream(blocks);
  return {
    id,
    type: 'RIDE',
    durationMin: totalMin(blocks),
    tss: computeRideTss(samples, FTP),
    rpe,
    samples,
    zones: null,
  };
}

function run(id: string, blocks: Block[], rpe: number | null = null): ReviewWorkout {
  const samples = stream(blocks);
  const min = totalMin(blocks);
  const km = samples.reduce((s, x) => s + (x.speedMps ?? 0), 0) / 1000;
  return { id, type: 'RUN', durationMin: min, tss: computeRunTss(min, km, THRESHOLD_PACE), rpe, samples, zones: null };
}

function planned(over: Partial<ReviewPlannedDay>): ReviewPlannedDay {
  return {
    name: 'Session',
    discipline: 'BIKE',
    durationMin: null,
    trainingStress: null,
    category: null,
    focus: null,
    isRestDay: false,
    restReason: null,
    segments: null,
    ...over,
  };
}

function seg(durationSec: number, intensityFraction?: number, role?: 'warmup' | 'cooldown') {
  return { durationSec, intensityFraction, role };
}

// 15 min warm-up, 4 x 8 min at threshold off 5 min easy, 10 min down: 77 min,
// 32 of them at threshold. The canonical "quality session" shape.
const THRESHOLD_SEGMENTS = [
  seg(15 * 60, 0.6, 'warmup'),
  ...[0, 1, 2, 3].flatMap(() => [seg(8 * 60, 0.98), seg(5 * 60, 0.55)]),
  seg(10 * 60, 0.55, 'cooldown'),
];

const THRESHOLD_DAY = planned({
  name: '4 x 8 threshold',
  durationMin: 77,
  trainingStress: 3,
  category: 'THRESHOLD',
  focus: 'Threshold work, specific to Amstel Gold',
  segments: THRESHOLD_SEGMENTS,
});

const ENDURANCE_DAY = planned({
  name: 'Steady 2 hours',
  durationMin: 120,
  trainingStress: 3,
  category: 'ENDURANCE',
  segments: [seg(120 * 60, 0.62)],
});

const cases: { name: string; planned: ReviewPlannedDay | null; workouts: ReviewWorkout[]; expect: string }[] = [
  {
    name: 'Threshold session, done as written',
    planned: THRESHOLD_DAY,
    expect: 'NAILED',
    workouts: [
      ride('a', [
        { min: 15, watts: 120 },
        ...[0, 1, 2, 3].flatMap(() => [
          { min: 8, watts: 197 },
          { min: 5, watts: 110 },
        ]),
        { min: 10, watts: 110 },
      ]),
    ],
  },
  {
    name: 'Threshold session swapped for a long steady ride (same load, wrong session)',
    planned: THRESHOLD_DAY,
    expect: 'MISSED, with the load-matched note',
    workouts: [
      ride('b', [
        { min: 15, watts: 120 },
        { min: 8, watts: 196 },
        { min: 5, watts: 110 },
        { min: 82, watts: 132 },
      ]),
    ],
  },
  {
    name: 'Threshold session, two of four intervals and home',
    planned: THRESHOLD_DAY,
    expect: 'OFF or MISSED, short on both time at threshold and duration',
    workouts: [
      ride('c', [
        { min: 15, watts: 120 },
        { min: 8, watts: 198 },
        { min: 5, watts: 110 },
        { min: 8, watts: 195 },
        { min: 8, watts: 110 },
      ]),
    ],
  },
  {
    name: 'Easy ride ridden easy',
    planned: ENDURANCE_DAY,
    expect: 'NAILED',
    workouts: [ride('d', [{ min: 125, watts: 128 }])],
  },
  {
    name: 'Easy ride turned into a tempo ride',
    planned: ENDURANCE_DAY,
    expect: 'OFF or MISSED on restraint, despite a higher load',
    workouts: [
      ride('e', [
        { min: 20, watts: 125 },
        { min: 70, watts: 172 },
        { min: 30, watts: 130 },
      ], 8),
    ],
  },
  {
    name: 'Planned ride, went for a run instead',
    planned: THRESHOLD_DAY,
    expect: 'discipline marked down',
    workouts: [run('f', [{ min: 70, mps: 2.9 }])],
  },
  {
    name: 'Split session: two rides adding up to the planned one',
    planned: ENDURANCE_DAY,
    expect: 'judged as one day, ~120 min',
    workouts: [ride('g1', [{ min: 60, watts: 126 }]), ride('g2', [{ min: 62, watts: 124 }])],
  },
  {
    name: 'No stream at all',
    planned: THRESHOLD_DAY,
    expect: 'SOLID at best — right shape, efforts unverifiable',
    workouts: [{ id: 'h', type: 'RIDE', durationMin: 77, tss: 85, rpe: null, samples: [], zones: null }],
  },
  {
    name: 'Heart-rate-only session against a tempo day',
    planned: planned({ name: 'Tempo hour', durationMin: 60, trainingStress: 2, category: 'TEMPO' }),
    expect: 'judged on overall intensity, with the heart-rate caveat',
    workouts: [
      {
        id: 'i',
        type: 'RIDE',
        durationMin: 60,
        tss: 55,
        rpe: null,
        samples: [],
        zones: { z1: 5, z2: 12, z3: 35, z4: 8, z5: 0 },
      },
    ],
  },
  {
    name: 'Rest day trained through hard',
    planned: planned({ isRestDay: true, restReason: 'Fatigue is running high (low Form) — recovery takes priority today', durationMin: null }),
    expect: 'REST_DAY, not gentle',
    workouts: [ride('j', [{ min: 90, watts: 185 }])],
  },
  {
    name: 'VO2max session, badly overcooked',
    planned: planned({
      name: '6 x 3 VO2max',
      durationMin: 70,
      trainingStress: 4,
      category: 'VO2MAX',
      segments: [seg(20 * 60, 0.6, 'warmup'), ...[0, 1, 2, 3, 4, 5].flatMap(() => [seg(3 * 60, 1.12), seg(3 * 60, 0.5)]), seg(14 * 60, 0.55, 'cooldown')],
    }),
    expect: 'marked down for doing far more than asked',
    workouts: [
      ride('k', [
        { min: 20, watts: 120 },
        ...Array.from({ length: 11 }, () => [
          { min: 3, watts: 232 },
          { min: 3, watts: 100 },
        ]).flat(),
        { min: 14, watts: 110 },
      ]),
    ],
  },
];

let failures = 0;
for (const c of cases) {
  const review = judgeSession({ date: new Date('2026-09-15T00:00:00Z'), planned: c.planned, workouts: c.workouts, thresholds });
  if (!review) {
    console.log(`\n${c.name}\n  !! no review produced`);
    failures++;
    continue;
  }
  console.log(`\n${c.name}`);
  console.log(`  expected: ${c.expect}`);
  console.log(`  -> ${review.grade}${review.score != null ? ` (${review.score})` : ''} — ${review.headline}`);
  console.log(`     basis ${review.basis}, measured from ${review.effortSource}, load ${review.load.actualTss ?? '—'} vs planned ~${review.load.plannedTss ?? '—'}`);
  for (const check of review.checks) {
    console.log(`     [${check.verdict}] ${check.label}: planned ${check.planned}, actual ${check.actual} — ${check.note}`);
  }
  for (const note of review.notes) console.log(`     · ${note}`);
  const bands = review.bands.filter((b) => (b.plannedMin ?? 0) > 0 || (b.actualMin ?? 0) > 0);
  if (bands.length) {
    console.log(`     bands: ${bands.map((b) => `${b.band} ${b.plannedMin ?? '—'}→${b.actualMin ?? '—'} min`).join(', ')}`);
  }
}

console.log(`\n${failures === 0 ? 'All scenarios produced a review.' : `${failures} scenario(s) produced nothing.`}`);
