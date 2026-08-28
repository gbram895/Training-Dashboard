import { prisma } from './prisma.js';
import { downloadFile, downloadFileBinary, listFolder, refreshAccessToken } from './dropbox.js';
import { parseFitWorkoutFile, parseZwoFile } from './workoutFormats.js';

const WORKOUT_LIBRARY_FOLDER = '/Workout Database';

export type PlannedDiscipline = 'BIKE' | 'RUN';

export interface ParsedWorkoutFile {
  path: string;
  name: string;
  discipline: PlannedDiscipline;
  durationMin?: number;
  intensity?: number;
  trainingStress?: number;
  profile?: string;
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

  const accessToken = await refreshAccessToken(config.dropboxRefreshToken);

  let entries;
  try {
    entries = await listFolder(accessToken, WORKOUT_LIBRARY_FOLDER);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not_found')) return [];
    throw err;
  }
  const supportedFiles = entries.filter((e) => /\.(txt|md|zwo|fit)$/i.test(e.name));

  const workouts: ParsedWorkoutFile[] = [];
  for (const entry of supportedFiles) {
    try {
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

      if (parsed) {
        workouts.push(parsed);
      } else {
        console.warn(`[workout-library] skipped ${entry.path_lower}: could not parse name/discipline`);
      }
    } catch (err) {
      console.error(`[workout-library] failed to read ${entry.path_lower}:`, err);
    }
  }

  return workouts.sort((a, b) => a.name.localeCompare(b.name));
}
