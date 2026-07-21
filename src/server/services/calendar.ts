import type { Application } from '@nocobase/server';
import { ensureFreshAccessToken } from './tokenStore';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

async function authFetch(app: Application, userId: number | string, path: string, init: RequestInit = {}) {
  const conn = await ensureFreshAccessToken(app, userId);
  const res = await fetch(`${CAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API ${res.status}: ${body}`);
  }
  return res.json();
}

export interface CalendarEntry {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

export async function listCalendars(app: Application, userId: number | string): Promise<CalendarEntry[]> {
  const res = await authFetch(app, userId, '/users/me/calendarList?minAccessRole=reader&showHidden=false');
  return (res.items || []).map((c: any) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
    timeZone: c.timeZone,
  }));
}

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  attendees?: Array<{ email: string; responseStatus?: string; organizer?: boolean; self?: boolean }>;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  calendarId?: string;
}

export interface ListEventsOptions {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
}

export async function listEvents(
  app: Application,
  userId: number | string,
  opts: ListEventsOptions = {},
): Promise<CalendarEvent[]> {
  const calendarId = opts.calendarId || 'primary';
  const params = new URLSearchParams();
  params.set('timeMin', opts.timeMin || new Date().toISOString());
  if (opts.timeMax) params.set('timeMax', opts.timeMax);
  if (opts.q) params.set('q', opts.q);
  params.set('singleEvents', String(opts.singleEvents ?? true));
  if (params.get('singleEvents') === 'true') {
    params.set('orderBy', opts.orderBy || 'startTime');
  }
  params.set('maxResults', String(Math.min(opts.maxResults || 25, 100)));

  const res = await authFetch(app, userId, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
  return (res.items || []).map((e: any) => ({ ...normalizeEvent(e), calendarId }));
}

/**
 * List upcoming events across calendars shared with the user (i.e. not the primary calendar
 * and where the user does not own the calendar). Useful for "what's on shared calendars?".
 */
export async function listSharedEvents(
  app: Application,
  userId: number | string,
  opts: Omit<ListEventsOptions, 'calendarId'> = {},
): Promise<CalendarEvent[]> {
  const calendars = await listCalendars(app, userId);
  const shared = calendars.filter((c) => !c.primary && c.accessRole !== 'owner');
  const results: CalendarEvent[] = [];
  for (const cal of shared) {
    try {
      const events = await listEvents(app, userId, { ...opts, calendarId: cal.id });
      results.push(...events);
    } catch {
      // skip calendars we can't read
    }
  }
  // Chronological sort by start time.
  return results.sort((a, b) => startTime(a).localeCompare(startTime(b)));
}

export interface CreateEventInput {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; optional?: boolean }>;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

export async function createEvent(
  app: Application,
  userId: number | string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const calendarId = input.calendarId || 'primary';
  const params = new URLSearchParams();
  if (input.sendUpdates) params.set('sendUpdates', input.sendUpdates);
  const body = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: input.start,
    end: input.end,
    attendees: input.attendees,
  };
  const res = await authFetch(app, userId, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { ...normalizeEvent(res), calendarId };
}

function normalizeEvent(e: any): CalendarEvent {
  return {
    id: e.id,
    status: e.status,
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.start,
    end: e.end,
    htmlLink: e.htmlLink,
    attendees: e.attendees,
    organizer: e.organizer,
  };
}

function startTime(e: CalendarEvent): string {
  return e.start?.dateTime || e.start?.date || '';
}