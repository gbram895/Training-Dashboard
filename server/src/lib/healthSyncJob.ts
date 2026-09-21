import { prisma } from './prisma.js';
import { downloadFile, listFolder, refreshAccessToken } from './dropbox.js';
import { applyHealthFiles } from './healthImport.js';
import type { HealthAutoExportFile } from './appleHealth.js';

const MAX_REPORTED_FAILURES = 3;

/** Null when everything imported, otherwise a message short enough for the sync bar. */
function summariseFailures(failures: string[]): string | null {
  if (failures.length === 0) return null;
  const shown = failures.slice(0, MAX_REPORTED_FAILURES).join('; ');
  const rest = failures.length - MAX_REPORTED_FAILURES;
  return `${failures.length} file(s) could not be imported — ${shown}${rest > 0 ? ` (+${rest} more)` : ''}`;
}

export async function runSyncForUser(userId: string, options: { force?: boolean } = {}) {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Dropbox is not connected for this account');

  const totals = {
    filesFound: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    filesFailed: 0,
    daysImported: 0,
    workoutsImported: 0,
  };

  // A file that fails to download or parse is skipped so the rest of the run
  // still lands, but it must not leave the run looking clean: without this the
  // dashboard reported "Last synced <now>" with no error while that day never
  // actually imported.
  const failures: string[] = [];

  try {
    const accessToken = await refreshAccessToken(config.dropboxRefreshToken);

    for (const folderPath of config.folderPaths) {
      const entries = await listFolder(accessToken, folderPath);
      const jsonFiles = entries.filter((e) => e.name.toLowerCase().endsWith('.json'));
      totals.filesFound += jsonFiles.length;
      console.log(`[health-sync] ${folderPath}: ${jsonFiles.length} files`);

      for (const entry of jsonFiles) {
        const serverModified = new Date(entry.server_modified);
        const existing = await prisma.syncedDropboxFile.findUnique({
          where: { userId_path: { userId, path: entry.path_lower } },
        });
        if (
          !options.force &&
          existing &&
          existing.serverModified.getTime() === serverModified.getTime()
        ) {
          totals.filesSkipped += 1;
          continue;
        }

        try {
          const text = await downloadFile(accessToken, entry.path_lower);
          const file = JSON.parse(text) as HealthAutoExportFile;
          const result = await applyHealthFiles(userId, [file]);
          totals.daysImported += result.daysImported;
          totals.workoutsImported += result.workoutsImported;

          await prisma.syncedDropboxFile.upsert({
            where: { userId_path: { userId, path: entry.path_lower } },
            create: { userId, path: entry.path_lower, serverModified },
            update: { serverModified, syncedAt: new Date() },
          });
          totals.filesProcessed += 1;
        } catch (fileErr) {
          console.error(`[health-sync] failed to process ${entry.path_lower}:`, fileErr);
          totals.filesFailed += 1;
          failures.push(`${entry.name}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
        }
      }
    }

    await prisma.healthSyncConfig.update({
      where: { userId },
      data: { lastSyncedAt: new Date(), lastSyncError: summariseFailures(failures) },
    });

    return totals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.healthSyncConfig.update({
      where: { userId },
      data: { lastSyncError: message },
    });
    throw err;
  }
}

export async function runAllSyncs() {
  const configs = await prisma.healthSyncConfig.findMany({ select: { userId: true } });
  for (const { userId } of configs) {
    try {
      const result = await runSyncForUser(userId);
      console.log(`[health-sync] user ${userId}:`, result);
    } catch (err) {
      console.error(`[health-sync] user ${userId} failed:`, err);
    }
  }
}
