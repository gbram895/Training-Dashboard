import { XMLParser } from 'fast-xml-parser';
import ical, { type VEvent } from 'node-ical';

// A small CalDAV client, just enough for iCloud: find the account's
// calendars, then read the events in a date range. A web app has no way into
// the iPhone's Calendar itself, but the Calendar app keeps its own calendars
// in iCloud, and iCloud speaks CalDAV to anything holding an app-specific
// password. A Google or Outlook account added on the phone syncs straight
// from that provider instead, never through iCloud; those come in as a
// private .ics link (fetchFeedEvents below).
//
// Three requests to connect (who am I → where are my calendars → which are
// they) and one REPORT per calendar to read a range. Recurring events are
// expanded here rather than by the server: node-ical applies EXDATEs, moved
// occurrences and DST correctly, and not every server honours <C:expand>.

/** Every event in the plan's own .ics feed has a UID ending in this. See routes/calendar.ts. */
export const PLAN_FEED_UID_SUFFIX = '@plan.gradient';

const CALDAV_URL = process.env.CALDAV_URL ?? 'https://caldav.icloud.com/';

export interface CalendarInfo {
  /** 'caldav' is a calendar on the iCloud account; 'ics' a private link to any other calendar. */
  kind: 'caldav' | 'ics';
  url: string;
  name: string;
  color: string | null;
  enabled: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** An instant; for an all-day event, UTC midnight of its first day. */
  start: string;
  /** An instant; for an all-day event, UTC midnight of the day after its last. */
  end: string;
  allDay: boolean;
  /** False for events marked "Show as: Free" — shown, but never planned around. */
  busy: boolean;
  calendar: string;
  color: string | null;
  location: string | null;
}

export class CalDavError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  isArray: (name) => name === 'response' || name === 'propstat' || name === 'comp',
});

function authHeader(appleId: string, password: string): string {
  return `Basic ${Buffer.from(`${appleId}:${password}`).toString('base64')}`;
}

async function dav(
  method: 'PROPFIND' | 'REPORT',
  url: string,
  depth: '0' | '1',
  body: string,
  auth: string,
): Promise<any[]> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: auth, Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CalDavError(`Could not reach the calendar server (${(err as Error).message})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalDavError(
      'iCloud did not accept the Apple ID and app-specific password. Check both, or make a new app-specific password.',
      res.status,
    );
  }
  if (res.status !== 207) throw new CalDavError(`The calendar server answered ${res.status}`, res.status);
  const doc = parser.parse(await res.text());
  return doc?.multistatus?.response ?? [];
}

/** The `prop` of a response's successful propstat, if it has one. */
function okProp(response: any): any {
  const stat = (response.propstat ?? []).find((p: any) => String(p.status ?? '').includes(' 200'));
  return stat?.prop ?? {};
}

function hrefOf(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value.href === 'string') return value.href.trim();
  return null;
}

function text(value: any): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value['#text'] === 'string') return value['#text'].trim();
  return null;
}

/** Finds every calendar on the account that can hold events. */
export async function discoverCalendars(appleId: string, password: string): Promise<CalendarInfo[]> {
  const auth = authHeader(appleId, password);

  const [root] = await dav(
    'PROPFIND',
    CALDAV_URL,
    '0',
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    auth,
  );
  const principal = hrefOf(okProp(root ?? {})['current-user-principal']);
  if (!principal) throw new CalDavError('The calendar server did not say which account this is');

  const [principalRes] = await dav(
    'PROPFIND',
    new URL(principal, CALDAV_URL).toString(),
    '0',
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>',
    auth,
  );
  const home = hrefOf(okProp(principalRes ?? {})['calendar-home-set']);
  if (!home) throw new CalDavError('The calendar server did not say where the calendars are');
  // iCloud answers with an absolute URL on the account's own partition
  // (pNN-caldav.icloud.com); a relative one is resolved against the server.
  const homeUrl = new URL(home, CALDAV_URL).toString();

  const listing = await dav(
    'PROPFIND',
    homeUrl,
    '1',
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
       <d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/></d:prop>
     </d:propfind>`,
    auth,
  );

  const calendars: CalendarInfo[] = [];
  for (const response of listing) {
    const prop = okProp(response);
    const type = prop.resourcetype;
    if (!type || typeof type !== 'object' || !('calendar' in type)) continue;
    // A calendar that says what it holds and doesn't list events is a
    // reminders list or similar; one that says nothing is assumed to be events.
    const comps: any[] | undefined = prop['supported-calendar-component-set']?.comp;
    if (comps && !comps.some((c) => c?.['@_name'] === 'VEVENT')) continue;
    const href = hrefOf(response.href);
    if (!href) continue;
    const color = text(prop['calendar-color']);
    calendars.push({
      kind: 'caldav',
      url: new URL(href, homeUrl).toString(),
      name: text(prop.displayname) || 'Calendar',
      // iCloud gives #RRGGBBAA; CSS takes that, but the alpha is always FF.
      color: color && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : null,
      enabled: true,
    });
  }
  return calendars;
}

function icalStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** YYYY-MM-DD of a date-only value, which node-ical builds as local midnight. */
function dateOnlyKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function paramText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'val' in (value as any)) return String((value as any).val ?? '');
  return String(value);
}

/**
 * Every occurrence of every event in [from, to), across the given calendars,
 * sorted by start. `account` is needed only for iCloud calendars.
 */
export async function fetchEvents(
  account: { appleId: string; password: string } | null,
  calendars: CalendarInfo[],
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const auth = account ? authHeader(account.appleId, account.password) : null;
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:prop><c:calendar-data/></d:prop>
    <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
      <c:time-range start="${icalStamp(from)}" end="${icalStamp(to)}"/>
    </c:comp-filter></c:comp-filter></c:filter>
  </c:calendar-query>`;

  const perCalendar = await Promise.all(
    calendars
      .filter((c) => c.enabled)
      .map(async (calendar) => {
        if (calendar.kind === 'ics') return fetchFeedEvents(calendar, from, to);
        if (!auth) return [];
        const responses = await dav('REPORT', calendar.url, '1', body, auth);
        const events: CalendarEvent[] = [];
        for (const response of responses) {
          const data = text(okProp(response)['calendar-data']);
          if (data) events.push(...eventsFromIcs(data, calendar, from, to));
        }
        return events;
      }),
  );

  return perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
}

/** Reads a whole .ics feed — Google's "secret address in iCal format", Outlook's published link. */
export async function fetchFeedText(url: string): Promise<string> {
  const httpsUrl = url.replace(/^webcals?:\/\//i, 'https://');
  let res: Response;
  try {
    res = await fetch(httpsUrl, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/calendar' } });
  } catch (err) {
    throw new CalDavError(`Could not reach that calendar link (${(err as Error).message})`);
  }
  if (!res.ok) throw new CalDavError(`That calendar link answered ${res.status}`, res.status);
  const body = await res.text();
  if (!body.includes('BEGIN:VCALENDAR')) throw new CalDavError('That link is not a calendar (.ics) feed');
  return body;
}

async function fetchFeedEvents(calendar: CalendarInfo, from: Date, to: Date): Promise<CalendarEvent[]> {
  return eventsFromIcs(await fetchFeedText(calendar.url), calendar, from, to);
}

/** The calendar's own name inside a feed (X-WR-CALNAME), for labelling a pasted link. */
export function feedName(ics: string): string | null {
  const match = ics.match(/^X-WR-CALNAME:(.+)$/m);
  return match ? match[1].trim() : null;
}

/** Expands one calendar object (an .ics body) into its occurrences inside [from, to). Exported for testing. */
export function eventsFromIcs(
  ics: string,
  calendar: Pick<CalendarInfo, 'name' | 'color'>,
  from: Date,
  to: Date,
): CalendarEvent[] {
  let parsed: ReturnType<typeof ical.sync.parseICS>;
  try {
    parsed = ical.sync.parseICS(ics);
  } catch {
    return [];
  }

  const out: CalendarEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT') continue;
    const event = component as VEvent;
    // A moved occurrence is folded into its series by node-ical; on its own
    // it would be counted twice.
    if ((event as any).recurrenceid) continue;
    // Our own planned sessions, if the athlete subscribed to the plan feed in
    // a way that lands it back in iCloud: planning around them would have the
    // plan dodging itself.
    if (String(event.uid ?? '').endsWith(PLAN_FEED_UID_SUFFIX)) continue;

    const instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    for (const instance of instances) {
      const source = instance.event;
      if (source.status === 'CANCELLED') continue;

      let start: Date;
      let end: Date;
      if (instance.isFullDay) {
        start = new Date(`${dateOnlyKey(instance.start)}T00:00:00Z`);
        const endKey = instance.end ? dateOnlyKey(instance.end) : null;
        end = endKey ? new Date(`${endKey}T00:00:00Z`) : new Date(start.getTime() + 86_400_000);
        if (end <= start) end = new Date(start.getTime() + 86_400_000);
      } else {
        start = new Date(instance.start);
        end = instance.end ? new Date(instance.end) : start;
      }
      if (end <= from || start >= to) continue;

      out.push({
        id: `${event.uid}:${start.toISOString()}`,
        title: paramText(instance.summary).trim() || 'Busy',
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: instance.isFullDay,
        busy: source.transparency !== 'TRANSPARENT',
        calendar: calendar.name,
        color: calendar.color,
        location: paramText(source.location).trim() || null,
      });
    }
  }
  return out;
}
