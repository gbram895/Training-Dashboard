import { prisma } from './prisma.js';
import { fetchWorkoutLibrary, type ParsedWorkoutFile } from './workoutLibrary.js';
import { generatePlanWindow } from './trainingPlan.js';
import { pushConfigured, sendToUser } from './webPush.js';

/**
 * Tells the athlete when workouts have been added to the Dropbox library.
 *
 * "New" here means a file path that has never been in the library before, not
 * a file whose contents changed. Editing a workout already on the shelf —
 * fixing a typo in its profile, nudging an interval — updates its
 * CachedLibraryWorkout row in place and says nothing, which is what you want
 * from something that interrupts you on your phone. The cache that
 * lib/workoutLibrary.ts already keeps is what makes this cheap: it creates a
 * row the first time it sees a path, so an unnotified row _is_ a new upload.
 *
 * Everything found in one check goes out as a single notification. Dropping a
 * folder of twenty workouts in at once is the normal way this happens, and
 * twenty separate pushes for it would be unusable.
 *
 * The same check also rebuilds the plan, so a new workout can be scheduled the
 * same day rather than waiting for the 04:00 rebuild. That half runs whether
 * or not the athlete has notifications switched on.
 */

/** Names listed in full before the body falls back to "and N more". */
const NAMES_IN_BODY = 3;

function describe(workout: ParsedWorkoutFile): string {
  const bits: string[] = [workout.discipline === 'BIKE' ? 'bike' : 'run'];
  if (workout.durationMin) bits.push(`${workout.durationMin} min`);
  return `${workout.name} (${bits.join(', ')})`;
}

/** Exported for the sake of being readable in isolation; only used just below. */
export function buildNewWorkoutBody(workouts: ParsedWorkoutFile[]): string {
  // A single new workout has room to say what it actually is, which is the
  // difference between "something arrived" and "tomorrow's session is here".
  if (workouts.length === 1) return `New workout in your library: ${describe(workouts[0])}`;

  const names = workouts.map((w) => w.name);
  const shown = names.slice(0, NAMES_IN_BODY);
  const remaining = names.length - shown.length;
  const list =
    remaining > 0
      ? `${shown.join(', ')} and ${remaining} more`
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;

  return `${workouts.length} new workouts in your library: ${list}`;
}

/**
 * Refreshes one user's library, rebuilds their plan around anything newly
 * uploaded, and tells them about it. Returns how many new workouts were found,
 * which is 0 both when nothing is new and on the very first check.
 */
export async function notifyNewLibraryWorkouts(userId: string): Promise<number> {
  const config = await prisma.healthSyncConfig.findUnique({
    where: { userId },
    select: { libraryBaselineAt: true },
  });
  if (!config) return 0;

  // This is also what populates the cache, so it has to happen before the
  // unnotified rows are read — the new files are created by this call.
  await fetchWorkoutLibrary(userId);

  const pending = await prisma.cachedLibraryWorkout.findMany({
    where: { userId, notifiedAt: null },
    orderBy: { firstSeenAt: 'asc' },
    select: { id: true, parsed: true },
  });

  async function markAnnounced() {
    if (pending.length === 0) return;
    await prisma.cachedLibraryWorkout.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { notifiedAt: new Date() },
    });
  }

  // First check for this connection: whatever is in the folder now is the
  // library the athlete already has. Record that we have seen it and stay
  // quiet, so enabling this doesn't announce years of accumulated files.
  if (!config.libraryBaselineAt) {
    await markAnnounced();
    await prisma.healthSyncConfig.update({ where: { userId }, data: { libraryBaselineAt: new Date() } });
    console.log(`[new-workouts] baselined ${pending.length} existing file(s) for user ${userId} — nothing sent`);
    return 0;
  }

  if (pending.length === 0) return 0;

  // Rebuilt before the push goes out, so the plan the notification links to
  // already has the new workouts in it. Manually rearranged days and one-off
  // overrides survive this like any other rebuild.
  await generatePlanWindow(userId);

  if (pushConfigured()) {
    const workouts = pending.map((row) => row.parsed as unknown as ParsedWorkoutFile);
    await sendToUser(userId, {
      title: 'Gradient',
      body: buildNewWorkoutBody(workouts),
      // The workout library lives on the Plan tab, under everything else.
      url: '/plan',
    });
  }
  await markAnnounced();

  return pending.length;
}

/** Scheduled-job entry point: checks every user with Dropbox connected. */
export async function notifyAllNewLibraryWorkouts(): Promise<void> {
  // Only a user who has connected Dropbox has a library to watch at all, and
  // fetching one for anybody else just throws.
  const connected = await prisma.healthSyncConfig.findMany({ select: { userId: true } });

  for (const { userId } of connected) {
    try {
      const found = await notifyNewLibraryWorkouts(userId);
      if (found > 0) console.log(`[new-workouts] ${found} new file(s) for user ${userId}: plan rebuilt`);
    } catch (err) {
      console.error(`[new-workouts] check failed for user ${userId}:`, err);
    }
  }
}
