import type { Application } from '@nocobase/server';
import { z } from 'zod';
import * as gmail from './services/gmail';
import * as calendar from './services/calendar';

const GROUP = 'googleTools';

/**
 * Register plugin-noco-tools' Google functions as tools callable by NocoBase AI employees.
 *
 * The AI plugin (plugin-ai) exposes a tools manager on:
 *   app.aiManager.toolsManager
 *
 * Tool shape per @nocobase/plugin-ai/dist/server/manager/tool-manager.d.ts:
 *   registerTools({ groupName, tool: { name, title, description, schema (zod), invoke(ctx, args, id) } })
 *   invoke must return { status: 'success' | 'error', content: string }
 *
 * Per-user isolation: `invoke` receives a NocoBase ctx bound to the user currently
 * chatting with the AI employee. We resolve the userId from ctx.state.currentUser and
 * pass it to gmail/calendar service helpers, which key every token lookup by userId
 * (see googleConnections.userId is UNIQUE). So User A's employee only ever sees User
 * A's Google account.
 */
export function registerAITools(app: Application): void {
  const aiPlugin: any = safeGet(app, 'ai');
  const toolsManager: any =
    aiPlugin?.aiManager?.toolsManager ||
    aiPlugin?.aiManager?.ai?.toolsManager ||
    (app as any).aiManager?.toolsManager;
  if (!toolsManager || typeof toolsManager.registerTools !== 'function') {
    app.logger?.info?.('[noco-tools] plugin-ai not detected; skipping AI tool registration. REST endpoints remain available.');
    return;
  }

  try {
    toolsManager.registerToolGroup?.({
      groupName: GROUP,
      title: 'Google (Gmail + Calendar)',
      description: 'Tools that let AI employees act on the caller\'s Google account (Gmail and Calendar).',
      sort: 100,
    });
  } catch {
    // Group may already be registered — safe to ignore.
  }

  const requireUser = (ctx: any): number => {
    const userId = ctx?.state?.currentUser?.id ?? ctx?.auth?.user?.id ?? ctx?.user?.id;
    if (!userId) throw new Error('AI tool must run in a user-authenticated context.');
    return Number(userId);
  };

  const success = (data: unknown) => ({ status: 'success' as const, content: JSON.stringify(data) });
  const failure = (err: unknown) => ({ status: 'error' as const, content: err instanceof Error ? err.message : String(err) });

  const tools: any[] = [
    {
      groupName: GROUP,
      tool: {
        name: 'listEmails',
        title: 'Gmail — list emails',
        description: 'List recent emails for the current user. Supports a Gmail search query (Gmail search syntax) and maxResults.',
        schema: z.object({
          query: z.string().optional().describe('Gmail search query, e.g. `is:unread from:alice@example.com newer_than:7d`.'),
          maxResults: z.number().int().min(1).max(50).optional().default(10),
          labelIds: z.array(z.string()).optional().describe('Optional label ids to restrict.'),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await gmail.listEmails(app, requireUser(ctx), args || {})); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'getEmail',
        title: 'Gmail — get email',
        description: 'Fetch a single email by id including headers, text body, and HTML body. Use this to read/summarize an email.',
        schema: z.object({
          id: z.string().describe('Gmail message id.'),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await gmail.getEmail(app, requireUser(ctx), String(args.id))); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'sendEmail',
        title: 'Gmail — send email',
        description: 'Send an email on behalf of the connected user.',
        schema: z.object({
          to: z.union([z.string(), z.array(z.string())]),
          cc: z.union([z.string(), z.array(z.string())]).optional(),
          bcc: z.union([z.string(), z.array(z.string())]).optional(),
          subject: z.string(),
          body: z.string(),
          isHtml: z.boolean().optional().default(false),
          replyToMessageId: z.string().optional(),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await gmail.sendEmail(app, requireUser(ctx), args)); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'listCalendars',
        title: 'Calendar — list calendars',
        description: 'List every calendar the user has access to (owned + shared). Use this before listEvents/createEvent when the user refers to a calendar by name.',
        schema: z.object({}),
        invoke: async (ctx: any) => {
          try { return success(await calendar.listCalendars(app, requireUser(ctx))); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'listEvents',
        title: 'Calendar — list events',
        description: 'List events on a specific calendar (defaults to the user\'s primary calendar).',
        schema: z.object({
          calendarId: z.string().optional().describe('Calendar id; defaults to "primary".'),
          timeMin: z.string().optional().describe('ISO 8601, defaults to now.'),
          timeMax: z.string().optional().describe('ISO 8601.'),
          q: z.string().optional().describe('Free-text search across event fields.'),
          maxResults: z.number().int().min(1).max(100).optional().default(25),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await calendar.listEvents(app, requireUser(ctx), args || {})); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'createEvent',
        title: 'Calendar — create event',
        description: 'Create a new event on the user\'s calendar. Set attendees to invite people; set sendUpdates="all" to email them the invitation.',
        schema: z.object({
          calendarId: z.string().optional().default('primary'),
          summary: z.string(),
          description: z.string().optional(),
          location: z.string().optional(),
          start: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }).describe('Use { dateTime, timeZone } for timed events or { date } for all-day.'),
          end: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }),
          attendees: z.array(z.object({
            email: z.string(),
            optional: z.boolean().optional(),
          })).optional(),
          sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await calendar.createEvent(app, requireUser(ctx), args)); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'updateEvent',
        title: 'Calendar — update event',
        description: 'Partial-update fields on an existing event. Only the provided fields change. Use this to reschedule, edit summary/description/location, or change attendees.',
        schema: z.object({
          calendarId: z.string().optional().default('primary'),
          eventId: z.string(),
          summary: z.string().optional(),
          description: z.string().optional(),
          location: z.string().optional(),
          start: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }).optional(),
          end: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }).optional(),
          attendees: z.array(z.object({
            email: z.string(),
            optional: z.boolean().optional(),
          })).optional(),
          sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await calendar.updateEvent(app, requireUser(ctx), args)); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'deleteEvent',
        title: 'Calendar — delete event',
        description: 'Cancel / delete an event by id. Set sendUpdates="all" to notify attendees of the cancellation.',
        schema: z.object({
          calendarId: z.string().optional().default('primary'),
          eventId: z.string(),
          sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await calendar.deleteEvent(app, requireUser(ctx), args)); }
          catch (e) { return failure(e); }
        },
      },
    },
    {
      groupName: GROUP,
      tool: {
        name: 'listSharedEvents',
        title: 'Calendar — list events on shared calendars',
        description: 'List events from calendars shared with the user (excluding their own primary/owned calendars).',
        schema: z.object({
          timeMin: z.string().optional(),
          timeMax: z.string().optional(),
          q: z.string().optional(),
          maxResults: z.number().int().min(1).max(100).optional().default(25),
        }),
        invoke: async (ctx: any, args: any) => {
          try { return success(await calendar.listSharedEvents(app, requireUser(ctx), args || {})); }
          catch (e) { return failure(e); }
        },
      },
    },
  ];

  try {
    toolsManager.registerTools(tools);
    app.logger?.info?.(`[noco-tools] Registered ${tools.length} AI tools under group '${GROUP}'.`);
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