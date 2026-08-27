import { randomUUID } from 'node:crypto';
import type { GarminConnect, GarminTokens } from './garmin.js';

// Garmin's SSO login has no public API and no documented MFA step — this
// replicates the (proven-working, via the garmin-connect package) username/
// password flow and adds the MFA code-verification step on top, based on how
// Garmin's web sign-in flow behaves. It may need adjusting if Garmin changes
// the sign-in page.

const CSRF_RE = /name="_csrf"\s+value="(.+?)"/;
const TICKET_RE = /ticket=([^"]+)"/;
const USER_AGENT_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';

interface PendingGarminLogin {
  client: GarminConnect;
  csrfToken: string;
  signinUrl: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingLogins = new Map<string, PendingGarminLogin>();

/** Pulls out the parts of a Garmin SSO page that actually say what it wants, instead of dumping raw HTML. */
function describeGarminPage(html: string): string {
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((m) => m[0]);
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
  const contextSnippets = [...html.matchAll(/.{0,80}(verif|mfa|security code|authenticat|2-step|two-step)/gi)].map(
    (m) => m[0].replace(/\s+/g, ' ').trim(),
  );
  return JSON.stringify(
    { length: html.length, forms, inputs, contextSnippets: contextSnippets.slice(0, 10) },
    null,
    2,
  );
}

function sweepExpiredPendingLogins() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pendingLogins) {
    if (entry.createdAt < cutoff) pendingLogins.delete(id);
  }
}

export interface GarminLoginResult {
  tokens?: GarminTokens;
  pendingId?: string;
}

async function finishGarminLogin(client: GarminConnect, ticket: string): Promise<GarminTokens> {
  const http = client.client;
  const oauth1 = await http.getOauth1Token(ticket);
  await http.exchange(oauth1);
  return client.exportToken();
}

export async function beginGarminLogin(
  client: GarminConnect,
  username: string,
  password: string,
): Promise<GarminLoginResult> {
  sweepExpiredPendingLogins();

  const http = client.client;
  await http.fetchOauthConsumer();
  const url = http.url;

  const step1Params = { clientId: 'GarminConnect', locale: 'en', service: url.GC_MODERN };
  await http.client.get(`${url.GARMIN_SSO_EMBED}?${new URLSearchParams(step1Params).toString()}`);

  const step2Params = {
    id: 'gauth-widget',
    embedWidget: 'true',
    locale: 'en',
    gauthHost: url.GARMIN_SSO_EMBED,
  };
  const step2Result = await http.get<string>(
    `${url.SIGNIN_URL}?${new URLSearchParams(step2Params).toString()}`,
  );
  const csrfMatch = CSRF_RE.exec(step2Result);
  if (!csrfMatch) throw new Error('Garmin login failed: could not find a CSRF token on the sign-in page');

  const signinParams = {
    id: 'gauth-widget',
    embedWidget: 'true',
    clientId: 'GarminConnect',
    locale: 'en',
    gauthHost: url.GARMIN_SSO_EMBED,
    service: url.GARMIN_SSO_EMBED,
    source: url.GARMIN_SSO_EMBED,
    redirectAfterAccountLoginUrl: url.GARMIN_SSO_EMBED,
    redirectAfterAccountCreationUrl: url.GARMIN_SSO_EMBED,
  };
  const signinUrl = `${url.SIGNIN_URL}?${new URLSearchParams(signinParams).toString()}`;

  const step3Body = new URLSearchParams({
    username,
    password,
    embed: 'true',
    _csrf: csrfMatch[1],
  }).toString();
  const step3Result = await http.post<string>(signinUrl, step3Body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Dnt: 1,
      Origin: url.GARMIN_SSO_ORIGIN,
      Referer: url.SIGNIN_URL,
      'User-Agent': USER_AGENT_BROWSER,
    },
  });

  http.handleAccountLocked(step3Result);
  http.handlePageTitle(step3Result);

  const ticketMatch = TICKET_RE.exec(step3Result);
  if (ticketMatch) {
    return { tokens: await finishGarminLogin(client, ticketMatch[1]) };
  }

  if (!step3Result.includes('verifyMFA')) {
    console.error('[garmin-auth] unexpected sign-in response:', describeGarminPage(step3Result));
    throw new Error('Garmin login failed: check your username and password');
  }

  const mfaCsrfMatch = CSRF_RE.exec(step3Result) ?? csrfMatch;
  const pendingId = randomUUID();
  pendingLogins.set(pendingId, {
    client,
    csrfToken: mfaCsrfMatch[1],
    signinUrl,
    createdAt: Date.now(),
  });
  return { pendingId };
}

export async function completeGarminMfaLogin(pendingId: string, code: string): Promise<GarminTokens> {
  const pending = pendingLogins.get(pendingId);
  if (!pending) throw new Error('This Garmin sign-in attempt has expired — please start over.');
  pendingLogins.delete(pendingId);

  const http = pending.client.client;
  const url = http.url;
  const signinQuery = new URL(pending.signinUrl).searchParams;
  const mfaParams = { ...Object.fromEntries(signinQuery), fromPage: 'setupEnterMfaCode' };
  const mfaUrl = `${url.GARMIN_SSO}/verifyMFA/loginEnterMfaCode?${new URLSearchParams(mfaParams).toString()}`;

  const mfaBody = new URLSearchParams({
    'mfa-code': code,
    embed: 'true',
    _csrf: pending.csrfToken,
    fromPage: 'setupEnterMfaCode',
  }).toString();

  const mfaResult = await http.post<string>(mfaUrl, mfaBody, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Dnt: 1,
      Origin: url.GARMIN_SSO_ORIGIN,
      Referer: pending.signinUrl,
      'User-Agent': USER_AGENT_BROWSER,
    },
  });

  const ticketMatch = TICKET_RE.exec(mfaResult);
  if (!ticketMatch) {
    console.error('[garmin-auth] unexpected MFA response:', describeGarminPage(mfaResult));
    throw new Error('Garmin MFA verification failed: incorrect or expired code');
  }
  return finishGarminLogin(pending.client, ticketMatch[1]);
}
