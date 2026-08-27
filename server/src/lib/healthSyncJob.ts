import { prisma } from './prisma.js';
import { downloadFile, listFolder, refreshAccessToken } from './dropbox.js';
import { applyHealthFiles } from './healthImport.js';
import type { HealthAutoExportFile } from './appleHealth.js';

export async function runSyncForUser(userId: string) {
  const config = await prisma.healthSyncConfig.findUnique({ where: { userId } });
  if (!config) throw new Error('Dropbox is not connected for this account');

  try {
    const accessToken = await refreshAccessToken(config.dropboxRefreshToken);
    const entries = await listFolder(accessToken, config.folderPath);
    const jsonFiles = entries.filter((e) => e.name.toLowerCase().endsWith('.json'));

    const files: HealthAutoExportFile[] = [];
    for (const entry of jsonFiles) {
      const text = await downloadFile(accessToken, entry.path_lower);
      files.push(JSON.parse(text));
    }

    const result = files.length > 0 ? await applyHealthFiles(userId, files) : { daysImported: 0, workoutsImported: 0 };

    await prisma.healthSyncConfig.update({
      where: { userId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });

    return { filesFound: files.length, ...result };
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
