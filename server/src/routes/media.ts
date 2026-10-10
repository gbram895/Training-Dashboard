import express, { Router, type Request } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { mailConfigured, sendMail, MAX_ATTACHMENTS_BYTES, type MailAttachment } from '../lib/mailer.js';

// Screenshots and recordings from IndoorWarior rides. The app posts each file
// as a raw body once the ride is saved; the workout page lists the ones taken
// within five minutes of its start and offers them as downloads.

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');
// How long a download link in a ride email keeps working.
const LINK_DAYS = 30;

const router = Router();
router.use(requireAuth);

const MAX_FILE = 60 * 1024 * 1024;
// The database is Neon's free tier (0.5 GB for everything), so media keeps to
// a fixed share of it: past this total per user the oldest files go first.
const MAX_TOTAL = 200 * 1024 * 1024;
const WINDOW_MS = 5 * 60 * 1000;
const TYPES: Record<string, 'photo' | 'video'> = {
  'image/png': 'photo',
  'image/jpeg': 'photo',
  'video/webm': 'video',
  'video/mp4': 'video',
};

function seconds(v: unknown): Date | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 1e9 ? new Date(n * 1000) : null;
}

// Strip codec parameters ("video/webm;codecs=vp9") down to the type itself.
function baseType(header: string | undefined): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

function meta(m: { id: string; startedAt: Date; takenAt: Date; kind: string; mime: string; size: number }) {
  return { id: m.id, startedAt: m.startedAt, takenAt: m.takenAt, kind: m.kind, mime: m.mime, size: m.size };
}

const select = { id: true, startedAt: true, takenAt: true, kind: true, mime: true, size: true } as const;

router.post(
  '/',
  express.raw({ type: Object.keys(TYPES), limit: MAX_FILE }),
  async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const mime = baseType(req.headers['content-type']);
    const kind = TYPES[mime];
    if (!kind) return res.status(415).json({ error: 'Only PNG, JPEG, WebM and MP4 files are kept.' });
    const startedAt = seconds(req.query.startedAt);
    const takenAt = seconds(req.query.takenAt) ?? startedAt;
    if (!startedAt || !takenAt) return res.status(400).json({ error: 'startedAt (unix seconds) is required.' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'The file was empty.' });
    if (body.length > MAX_TOTAL) return res.status(413).json({ error: 'That file is larger than the space media may use.' });

    const saved = await prisma.rideMedia.create({
      data: { userId, startedAt, takenAt, kind, mime, size: body.length, data: new Uint8Array(body) },
      select,
    });

    // Prune the oldest files beyond the per-user total, never the one just saved.
    const all = await prisma.rideMedia.findMany({
      where: { userId },
      select: { id: true, size: true },
      orderBy: { createdAt: 'desc' },
    });
    let total = 0;
    const drop: string[] = [];
    for (const m of all) {
      total += m.size;
      if (total > MAX_TOTAL && m.id !== saved.id) drop.push(m.id);
    }
    if (drop.length) await prisma.rideMedia.deleteMany({ where: { id: { in: drop }, userId } });

    res.status(201).json({ ...meta(saved), pruned: drop.length });
  },
);

// Media for one workout (by its start time), or for a ride by ?startedAt=.
router.get('/', async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  let at: Date | null = seconds(req.query.startedAt);
  if (!at && typeof req.query.workoutId === 'string') {
    const workout = await prisma.workout.findFirst({ where: { id: req.query.workoutId, userId }, select: { date: true } });
    if (!workout) return res.status(404).json({ error: 'Workout not found' });
    at = workout.date;
  }
  if (!at) return res.status(400).json({ error: 'workoutId or startedAt is required.' });
  const items = await prisma.rideMedia.findMany({
    where: {
      userId,
      startedAt: { gte: new Date(at.getTime() - WINDOW_MS), lte: new Date(at.getTime() + WINDOW_MS) },
    },
    select,
    orderBy: { takenAt: 'asc' },
  });
  res.json({ items: items.map(meta) });
});

function fileName(m: { mime: string; takenAt: Date }): string {
  const ext = m.mime === 'image/png' ? 'png' : m.mime === 'image/jpeg' ? 'jpg' : m.mime === 'video/mp4' ? 'mp4' : 'webm';
  return `indoorwarior-${m.takenAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

function sendFile(res: express.Response, m: { mime: string; size: number; takenAt: Date; data: Uint8Array }) {
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Content-Length', String(m.size));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(m)}"`);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(m.data));
}

router.get('/:id/file', async (req: AuthedRequest, res) => {
  const m = await prisma.rideMedia.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!m) return res.status(404).json({ error: 'Not found' });
  sendFile(res, m);
});

// Whether rides can be emailed, and to where, so IndoorWarior can say so.
router.get('/email', async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
  res.json({ configured: mailConfigured(), to: user?.email ?? null });
});

// Emails the ride's screenshots and recordings that have not gone out yet.
// IndoorWarior calls this once its uploads for a ride have finished. Files
// attach while they fit under the message limit; anything past it (usually a
// long recording) goes in as a download link instead.
const emailSchema = z.object({
  startedAt: z.number().int().positive(), // unix seconds
  title: z.string().max(200).optional(),
});

function linkBase(req: Request): string {
  return `${req.protocol}://${req.get('host')}/api/media-link`;
}

function rideDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.SYNC_TZ ?? 'Europe/Brussels',
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

router.post('/email', async (req: AuthedRequest, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!mailConfigured()) return res.json({ sent: false, reason: 'Email is not set up on Gradient.' });
  const userId = req.userId!;
  const at = new Date(parsed.data.startedAt * 1000);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const items = await prisma.rideMedia.findMany({
    where: {
      userId,
      emailedAt: null,
      startedAt: { gte: new Date(at.getTime() - WINDOW_MS), lte: new Date(at.getTime() + WINDOW_MS) },
    },
    orderBy: { takenAt: 'asc' },
  });
  if (!items.length) return res.json({ sent: false, reason: 'Nothing new to send for this ride.' });

  // Photos first so a large recording never crowds them out of the message.
  const ordered = [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'photo' ? -1 : 1));
  const attachments: MailAttachment[] = [];
  const links: { name: string; url: string; size: number }[] = [];
  let total = 0;
  for (const m of ordered) {
    if (total + m.size <= MAX_ATTACHMENTS_BYTES) {
      attachments.push({ filename: fileName(m), content: Buffer.from(m.data) });
      total += m.size;
    } else {
      const token = jwt.sign({ mid: m.id, uid: userId }, JWT_SECRET!, { expiresIn: `${LINK_DAYS}d` });
      links.push({ name: fileName(m), url: `${linkBase(req)}/${token}`, size: m.size });
    }
  }

  const photos = items.filter((m) => m.kind === 'photo').length;
  const videos = items.length - photos;
  const what = [photos && count(photos, 'screenshot', 'screenshots'), videos && count(videos, 'recording', 'recordings')]
    .filter(Boolean)
    .join(' and ');
  const title = parsed.data.title?.trim();
  const subject = `${title ? `${title}: ` : 'Your ride: '}${what}`;
  const when = rideDate(at);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;
  const linkText = links.length
    ? `\n\nToo large to attach, so download ${links.length === 1 ? 'it' : 'them'} here (links work for ${LINK_DAYS} days):\n` +
      links.map((l) => `${l.name} (${mb(l.size)}): ${l.url}`).join('\n')
    : '';
  const text = `${what} from your IndoorWarior ride${title ? ` "${title}"` : ''} on ${when}.${linkText}\n\nThey are also on the workout in Gradient.`;
  const html =
    `<p>${escapeHtml(what)} from your IndoorWarior ride${title ? ` <b>${escapeHtml(title)}</b>` : ''} on ${escapeHtml(when)}.</p>` +
    (links.length
      ? `<p>Too large to attach, so download ${links.length === 1 ? 'it' : 'them'} here (links work for ${LINK_DAYS} days):</p><ul>` +
        links.map((l) => `<li><a href="${l.url}">${escapeHtml(l.name)}</a> (${mb(l.size)})</li>`).join('') +
        '</ul>'
      : '') +
    '<p style="color:#666">They are also on the workout in Gradient.</p>';

  try {
    await sendMail({ to: user.email, subject, html, text, attachments });
  } catch (err) {
    console.error(`[media] ride email failed for user ${userId}:`, err);
    return res.status(502).json({ error: err instanceof Error ? err.message : 'The email could not be sent.' });
  }
  await prisma.rideMedia.updateMany({ where: { id: { in: items.map((m) => m.id) } }, data: { emailedAt: new Date() } });
  res.json({ sent: true, to: user.email, attached: attachments.length, linked: links.length });
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  const { count } = await prisma.rideMedia.deleteMany({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!count) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;

// The download links in ride emails. The signed token is the credential, as
// an email client opening the link has no Gradient login; it names one file
// and expires after LINK_DAYS.
export const mediaLinkRouter = Router();
mediaLinkRouter.get('/:token', async (req, res) => {
  let claims: { mid: string; uid: string };
  try {
    claims = jwt.verify(String(req.params.token), JWT_SECRET!) as unknown as { mid: string; uid: string };
  } catch {
    return res.status(410).type('text').send('This download link has expired.');
  }
  const m = await prisma.rideMedia.findFirst({ where: { id: claims.mid, userId: claims.uid } });
  if (!m) return res.status(404).type('text').send('This file is no longer kept in Gradient.');
  sendFile(res, m);
});
