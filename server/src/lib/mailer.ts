// Outgoing email, sent through Resend's HTTPS API. Render's free instances
// cannot open SMTP connections at all (ports 25, 465 and 587 are blocked),
// so an SMTP account such as Gmail's would never connect from here.
//
// Without a verified domain Resend sends only from onboarding@resend.dev and
// only to the address its account was created with, which is all a personal
// app needs: create the Resend account with the same email as the Gradient
// login. MAIL_FROM overrides the sender once a domain is verified.

const API = 'https://api.resend.com/emails';
// Resend refuses a message over 40 MB once attachments are base64-encoded
// (a third larger than the files), so stay well under it.
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type MailAttachment = { filename: string; content: Buffer };

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Email is not set up: RESEND_API_KEY is missing.');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'IndoorWarior <onboarding@resend.dev>',
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Email was refused (${res.status}): ${body?.message ?? res.statusText}`);
  }
}
