import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Seals a credential we have to keep in a form we can use again (an iCloud
// app-specific password has no OAuth refresh dance: the password itself is
// what CalDAV wants on every request), so a leaked database dump is not also
// a leaked password. The key comes from the environment, never the database.
// CALENDAR_SECRET when set; otherwise JWT_SECRET, which Render already
// generates — rotating that one logs everyone out AND means reconnecting the
// calendar, which is the same "sign in again" either way.
function key(): Buffer {
  const secret = process.env.CALENDAR_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return createHash('sha256').update(`calendar:${secret}`).digest();
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/** Null when the value was sealed under a different key (the secret was rotated) or is damaged. */
export function unseal(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body == null) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
