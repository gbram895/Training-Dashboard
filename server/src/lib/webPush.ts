import webpush from 'web-push';
import { prisma } from './prisma.js';
import { getPlannedDay } from './trainingPlan.js';

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
}

/** Sends to every subscription on file for a user, dropping any the push service reports as gone. */
async function sendToUser(userId: string, payload: NotificationPayload): Promise<void> {
  ensureConfigured();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // The browser unsubscribed (uninstalled, cleared site data, etc.) without telling us.
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        console.error(`[push] failed to notify user ${userId}:`, err);
      }
    }
  }
}

/** Daily reminder cron entry point: one notification per user who has a plan and at least one subscription. */
export async function sendDailyWorkoutReminders(): Promise<void> {
  if (!pushConfigured()) return;

  const userIds = await prisma.pushSubscription.findMany({
    select: { userId: true },
    distinct: ['userId'],
  });

  for (const { userId } of userIds) {
    try {
      const today = await getPlannedDay(userId, new Date());
      const payload = today
        ? today.isRestDay
          ? { title: 'Gradient', body: today.restReason ?? 'Rest day — no training scheduled today.', url: '/' }
          : { title: 'Gradient', body: `Today's session: ${today.name ?? 'a workout'} is ready.`, url: '/plan' }
        : { title: 'Gradient', body: 'Open the app to plan today’s training.', url: '/plan' };
      await sendToUser(userId, payload);
    } catch (err) {
      console.error(`[push] failed to build reminder for user ${userId}:`, err);
    }
  }
}
