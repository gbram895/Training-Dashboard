import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { downloadFile, downloadFileBinary, listFolder, refreshAccessToken, type DropboxFileEntry } from './dropbox.js';
import { parseFitWorkoutFile, parseZwoFile } from './workoutFormats.js';
import { classifyWorkoutCategory, type WorkoutCategory, type WorkoutSegment } from './workoutIntensity.js';

// Bounds how many files are downloaded+parsed concurrently on a cold cache
// (e.g. right after a big batch of new files is added) — fast enough to not
// take forever with a large library, gentle enough not to hammer Dropbox.
const FETCH_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const WORKOUT_LIBRARY_FOLDER = '/Workout Database';

/** Diagnostic only: lists top-level folder/file names so a wrong path is obvious from the logs. */
async function listRootEntries(accessToken: string): Promise<string[]> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '', recursive: false }),
  });
  if (!res.ok) return [`(failed to list root: ${res.status})`];
  const data = (await res.json()) as { entries: { name: string; '.tag': string }[] };
  return data.entries.map((e) => `${e.name} (${e['.tag']})`);
}

export type PlannedDiscipline = 'BIKE' | 'RUN';

export interface ParsedWorkoutFile {
  path: string;
  name: string;
  discipline: PlannedDiscipline;
  durationMin?: number;
  intensity?: number;
  trainingStress?: number;
  profile?: string;
  segments?: WorkoutSegment[];
  category?: WorkoutCategory;
}

type RawField = 'name' | 'type' | 'duration' | 'intensity' | 'trainingStress' | 'profile';

const FIELD_ALIASES: Record<string, RawField> = {
  name: 'name',
  title: 'name',
  type: 'type',
  discipline: 'type',
  sport: 'type',
  duration: 'duration',
  'duration (min)': 'duration',
  'duration min': 'duration',
  time: 'duration',
  intensity: 'intensity',
  'training stress': 'trainingStress',
  'training stress (1-5)': 'trainingStress',
  stress: 'trainingStress',
  tss: 'trainingStress',
  profile: 'profile',
  description: 'profile',
  notes: 'profile',
};

const FIELD_LINE_RE = /^([A-Za-z][A-Za-z \-()]*?)\s*:\s*(.*)$/;

function normalizeDiscipline(value: string | undefined): PlannedDiscipline | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/(bike|ride|cycl)/.test(v)) return 'BIKE';
  if (/run/.test(v)) return 'RUN';
  return null;
}

function parseIntSafe(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d+)/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function clamp1to5(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Math.min(5, Math.max(1, value));
}

/**
 * Expected file format (plain text, one workout per file):
 *   Name: Zone 2 Endurance Ride
 *   Type: Bike
 *   Duration: 90
 *   Intensity: 3
 *   Training Stress: 4
 *   Profile: Steady zone 2 effort with 3x5min tempo surges in the middle.
 *     Additional profile lines continue until the next recognized field.
 * Field names are case-insensitive with a few common synonyms; unrecognized
 * lines inside a "Profile" block are appended to it, so free-form descriptions
 * can span multiple lines.
 */
export function parseWorkoutFile(path: string, content: string): ParsedWorkoutFile | null {
  const raw: Partial<Record<RawField, string>> = {};
  let inProfile = false;

  for (const line of content.split(/\r?\n/)) {
    const match = FIELD_LINE_RE.exec(line);
    if (match) {
      const key = FIELD_ALIASES[match[1].trim().toLowerCase()];
      if (key) {
        raw[key] = match[2].trim();
        inProfile = key === 'profile';
        continue;
      }
    }
    if (inProfile && line.trim().length > 0) {
      raw.profile = raw.profile ? `${raw.profile}\n${line.trim()}` : line.trim();
    }
  }

  const name = raw.name?.trim();
  const discipline = normalizeDiscipline(raw.type);
  if (!name || !discipline) return null;

  return {
    path,
    name,
    discipline,
    durationMin: parseIntSafe(raw.duration),
    intensity: clamp1to5(parseIntSafe(raw.intensity)),
    trainingStress: clamp1to5(parseIntSafe(raw.trainingStress)),
    profile: raw.profile,
  };
}

async function parseEntry(
  accessToken: string,
  entry: DropboxFileEntry,
  thresholds: { ftpWatts: number; thresholdSpeedMps: number },
): Promise<ParsedWorkoutFile | null> {
  let parsed: ParsedWorkoutFile | null = null;
  if (/\.fit$/i.test(entry.name)) {
    const buffer = await downloadFileBinary(accessToken, entry.path_lower);
    parsed = parseFitWorkoutFile(entry.path_lower, buffer, thresholds);
  } else if (/\.zwo$/i.test(entry.name)) {
    const content = await downloadFile(accessToken, entry.path_lower);
    parsed = parseZwoFile(entry.path_lower, content);
  } else {
    const content = await downloadFile(accessToken, entry.path_lower);
    parsed = parseWorkoutFile(entry.path_lower, content);
  }

  if (parsed) parsed.category = classifyWorkoutCategory(parsed.segments ?? [], parsed.intensity);
  return parsed;
}

export async function fetchWorkoutLibrary(userId: string): Promise<ParsedWorkoutFile[]> {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Connect Dropbox first (from the dashboard) to load your workout library.');

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ftpWatts: true, thresholdPaceSecPerKm: true },
  });
  const thresholds = {
    ftpWatts: user.ftpWatts,
    thresholdSpeedMps: user.thresholdPaceSecPerKm > 0 ? 1000 / user.thresholdPaceSecPerKm : 0,
  };
  // .fit/.zwo parsing bakes FTP/threshold pace into each segment's intensity
  // fraction, so a cached parse is only valid while these haven't changed —
  // otherwise it's stale in exactly the way an edited source file would be.
  const thresholdsKey = `${user.ftpWatts}:${user.thresholdPaceSecPerKm}`;

  const accessToken = await refreshAccessToken(config.dropboxRefreshToken);

  let entries;
  try {
    entries = await listFolder(accessToken, WORKOUT_LIBRARY_FOLDER);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not_found')) {
      const rootEntries = await listRootEntries(accessToken).catch((e) => [`(failed to list root: ${e})`]);
      console.warn(
        `[workout-library] folder "${WORKOUT_LIBRARY_FOLDER}" not found in Dropbox for user ${userId}. ` +
          `Top-level Dropbox contents: ${rootEntries.join(', ') || '(empty)'}`,
      );
      return [];
    }
    throw err;
  }
  console.log(`[workout-library] found ${entries.length} file(s) in "${WORKOUT_LIBRARY_FOLDER}" for user ${userId}`);
  const supportedFiles = entries.filter((e) => /\.(txt|md|zwo|fit)$/i.test(e.name));

  const cachedRows = await prisma.cachedLibraryWorkout.findMany({ where: { userId } });
  const cacheByPath = new Map(cachedRows.map((c) => [c.path, c]));

  const fresh: ParsedWorkoutFile[] = [];
  const toFetch: DropboxFileEntry[] = [];

  for (const entry of supportedFiles) {
    const cached = cacheByPath.get(entry.path_lower);
    const serverModified = new Date(entry.server_modified);
    if (cached && cached.thresholdsKey === thresholdsKey && cached.serverModified.getTime() === serverModified.getTime()) {
      fresh.push(cached.parsed as unknown as ParsedWorkoutFile);
    } else {
      toFetch.push(entry);
    }
  }

  if (toFetch.length > 0) {
    console.log(`[workout-library] ${toFetch.length} new/changed file(s) to parse (${fresh.length} served from cache)`);
  }

  const parsedResults = await mapWithConcurrency(toFetch, FETCH_CONCURRENCY, async (entry) => {
    try {
      const parsed = await parseEntry(accessToken, entry, thresholds);
      if (!parsed) {
        console.warn(`[workout-library] skipped ${entry.path_lower}: could not parse name/discipline`);
        return null;
      }
      return { entry, parsed };
    } catch (err) {
      console.error(`[workout-library] failed to read ${entry.path_lower}:`, err);
      return null;
    }
  });

  const cacheWrites: Promise<unknown>[] = [];
  for (const result of parsedResults) {
    if (!result) continue;
    fresh.push(result.parsed);
    cacheWrites.push(
      prisma.cachedLibraryWorkout.upsert({
        where: { userId_path: { userId, path: result.entry.path_lower } },
        create: {
          userId,
          path: result.entry.path_lower,
          serverModified: new Date(result.entry.server_modified),
          thresholdsKey,
          parsed: result.parsed as unknown as Prisma.InputJsonValue,
        },
        update: {
          serverModified: new Date(result.entry.server_modified),
          thresholdsKey,
          parsed: result.parsed as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  const currentPaths = new Set(supportedFiles.map((e) => e.path_lower));
  const stalePaths = cachedRows.map((c) => c.path).filter((p) => !currentPaths.has(p));
  if (stalePaths.length > 0) {
    cacheWrites.push(prisma.cachedLibraryWorkout.deleteMany({ where: { userId, path: { in: stalePaths } } }));
  }
  // Cache writes are a pure perf optimization for next time — worth doing
  // best-effort, but a failure here shouldn't fail the actual library fetch.
  await Promise.all(cacheWrites).catch((err) => console.error('[workout-library] cache write failed:', err));

  return fresh.sort((a, b) => {
    const durationDiff = (a.durationMin ?? Infinity) - (b.durationMin ?? Infinity);
    return durationDiff !== 0 ? durationDiff : a.name.localeCompare(b.name);
  });
}
