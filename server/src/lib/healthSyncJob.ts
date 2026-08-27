import { prisma } from './prisma.js';
import { downloadFile, listFolder, refreshAccessToken } from './dropbox.js';
import { applyHealthFiles } from './healthImport.js';
import type { HealthAutoExportFile } from './appleHealth.js';

export async function runSyncForUser(userId: string) {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Dropbox is not connected for this account');

  const totals = {
    filesFound: 0,
    filesProcessed: 0,
    filesSkipped: 0,
    daysImported: 0,
    workoutsImported: 0,
  };

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
        if (existing && existing.serverModified.getTime() === serverModified.getTime()) {
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
        }
      }
    }

    await prisma.healthSyncConfig.update({
      where: { userId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
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
