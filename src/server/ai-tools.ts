import type { Application } from '@nocobase/server';
import { z } from 'zod';
import * as gmail from './services/gmail';
import * as calendar from './services/calendar';

/**
 * Register plugin-noco-tools' Google functions as AI-callable tools.
 *
 * Shape follows the runtime contract used by NocoBase's own `docs.js` and
 * `workflow-caller.js` (not the misleading `tool-manager.d.ts`):
 *
 *   {
 *     scope: 'GENERAL' | 'SPECIFIED' | 'CUSTOM',
 *     from: 'loader' | 'workflow',
 *     defaultPermission?: 'ALLOW' | 'DENY',
 *     introduction: { title, about },
 *     definition: { name, description, schema (zod) },
 *     invoke: async (ctx, args) => ({ status, content }),
 *   }
 *
 * The UI listBinding filter (aiTools.js:73) shows only:
 *   tool.scope === 'GENERAL' && tool.from === 'loader'
 * under "General tools" — so we set both.
 *
 * Per-user isolation: `invoke` receives a NocoBase ctx bound to whoever is chatting
 * with the AI employee. We resolve the userId from ctx.state.currentUser and pass it
 * to the gmail/calendar services, which key every token lookup by userId
 * (googleConnections.userId is UNIQUE). User A's employee only ever sees User A's
 * Google account.
 */
export function registerAITools(app: Application): void {
  const aiPlugin: any = safeGet(app, 'ai');
  const toolsManager: any =
    aiPlugin?.aiManager?.toolsManager ||
    aiPlugin?.ai?.toolsManager ||
    (app as any).aiManager?.toolsManager;
  if (!toolsManager || typeof toolsManager.registerTools !== 'function') {
    app.logger?.info?.('[noco-tools] plugin-ai not detected; skipping AI tool registration. REST endpoints remain available.');
    return;
  }

  const requireUser = (ctx: any): number => {
    const userId = ctx?.state?.currentUser?.id ?? ctx?.auth?.user?.id ?? ctx?.user?.id;
    if (!userId) throw new Error('AI tool must run in a user-authenticated context.');
    return Number(userId);
  };

  const success = (data: unknown) => ({ status: 'success' as const, content: JSON.stringify(data) });
  const failure = (err: unknown) => ({
    status: 'error' as const,
    content: err instanceof Error ? err.message : String(err),
  });

  const make = (
    name: string,
    title: string,
    about: string,
    description: string,
    schema: z.ZodObject<any>,
    run: (userId: number, args: any) => Promise<unknown>,
  ) => ({
    scope: 'GENERAL' as const,
    from: 'loader' as const,
    defaultPermission: 'ALLOW' as const,
    introduction: {
      title,
      about,
    },
    definition: {
      name,
      description,
      schema,
    },
    invoke: async (ctx: any, args: any) => {
      try {
        return success(await run(requireUser(ctx), args || {}));
      } catch (e) {
        return failure(e);
      }
    },
  });

  const tools = [
    make(
      'googleGmailListEmails',
      'Gmail — list emails',
      'List recent emails for the current user using Gmail search syntax.',
      'List recent emails for the current user. Supports a Gmail search query (Gmail search syntax) and maxResults.',
      z.object({
        query: z.string().optional().describe('Gmail search query, e.g. `is:unread from:alice@example.com newer_than:7d`.'),
        maxResults: z.number().int().min(1).max(50).optional().default(10),
        labelIds: z.array(z.string()).optional().describe('Optional label ids to restrict.'),
      }),
      (userId, args) => gmail.listEmails(app, userId, args),
    ),
    make(
      'googleGmailGetEmail',
      'Gmail — get email',
      'Fetch a single email by id including headers and bodies.',
      'Fetch a single email by id including headers, text body, and HTML body. Use this to read or summarize an email.',
      z.object({ id: z.string().describe('Gmail message id.') }),
      (userId, args) => gmail.getEmail(app, userId, String(args.id)),
    ),
    make(
      'googleGmailSendEmail',
      'Gmail — send email',
      'Send an email on the current user\'s behalf.',
      'Send an email on behalf of the connected user. `to/cc/bcc` accept a single email string or an array.',
      z.object({
        to: z.union([z.string(), z.array(z.string())]),
        cc: z.union([z.string(), z.array(z.string())]).optional(),
        bcc: z.union([z.string(), z.array(z.string())]).optional(),
        subject: z.string(),
        body: z.string(),
        isHtml: z.boolean().optional().default(false),
        replyToMessageId: z.string().optional(),
      }),
      (userId, args) => gmail.sendEmail(app, userId, args),
    ),
    make(
      'googleCalendarListCalendars',
      'Calendar — list calendars',
      'List every calendar the user has access to (owned + shared).',
      'List every calendar the user has access to (owned + shared). Use this before listEvents/createEvent when the user refers to a calendar by name.',
      z.object({}),
      (userId) => calendar.listCalendars(app, userId),
    ),
    make(
      'googleCalendarListEvents',
      'Calendar — list events',
      'List events on a specific calendar (defaults to primary).',
      'List events on a specific calendar (defaults to the user\'s primary calendar).',
      z.object({
        calendarId: z.string().optional().describe('Calendar id; defaults to "primary".'),
        timeMin: z.string().optional().describe('ISO 8601, defaults to now.'),
        timeMax: z.string().optional().describe('ISO 8601.'),
        q: z.string().optional().describe('Free-text search across event fields.'),
        maxResults: z.number().int().min(1).max(100).optional().default(25),
      }),
      (userId, args) => calendar.listEvents(app, userId, args),
    ),
    make(
      'googleCalendarCreateEvent',
      'Calendar — create event',
      'Create a new calendar event; can include attendees to invite.',
      'Create a new event on the user\'s calendar. Set `attendees` to invite people and `sendUpdates="all"` to email them the invitation.',
      z.object({
        calendarId: z.string().optional().default('primary'),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z
          .object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() })
          .describe('Use { dateTime, timeZone } for timed events or { date } for all-day.'),
        end: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }),
        attendees: z.array(z.object({ email: z.string(), optional: z.boolean().optional() })).optional(),
        sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
      }),
      (userId, args) => calendar.createEvent(app, userId, args),
    ),
    make(
      'googleCalendarUpdateEvent',
      'Calendar — update event',
      'Partial-update an existing event (reschedule, edit fields, change attendees).',
      'Partial-update fields on an existing event. Only the provided fields change. Use this to reschedule, edit summary/description/location, or change attendees.',
      z.object({
        calendarId: z.string().optional().default('primary'),
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).optional(),
        end: z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).optional(),
        attendees: z.array(z.object({ email: z.string(), optional: z.boolean().optional() })).optional(),
        sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
      }),
      (userId, args) => calendar.updateEvent(app, userId, args),
    ),
    make(
      'googleCalendarDeleteEvent',
      'Calendar — delete event',
      'Cancel / delete an event by id (optionally notify attendees).',
      'Cancel / delete an event by id. Set sendUpdates="all" to notify attendees of the cancellation.',
      z.object({
        calendarId: z.string().optional().default('primary'),
        eventId: z.string(),
        sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
      }),
      (userId, args) => calendar.deleteEvent(app, userId, args),
    ),
    make(
      'googleCalendarListSharedEvents',
      'Calendar — list events on shared calendars',
      'List events across calendars shared with the user.',
      'List events from calendars shared with the user (excluding their own primary/owned calendars).',
      z.object({
        timeMin: z.string().optional(),
        timeMax: z.string().optional(),
        q: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).optional().default(25),
      }),
      (userId, args) => calendar.listSharedEvents(app, userId, args),
    ),
  ];

  try {
    toolsManager.registerTools(tools);
    app.logger?.info?.(`[noco-tools] Registered ${tools.length} AI tools (scope=GENERAL, from=loader).`);
  } catch (err: any) {
    app.logger?.warn?.(`[noco-tools] Failed to register AI tools: ${err?.message || err}`);
  }
}

function safeGet(app: Application, name: string): any {
  try {
    return app.pm?.get?.(name);
  } catch {
    return undefined;
  }
}