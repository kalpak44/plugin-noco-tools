import type { Application } from '@nocobase/server';
import * as gmail from './services/gmail';
import * as calendar from './services/calendar';

/**
 * Register plugin-noco-tools' Google functions as tools callable by NocoBase AI employees.
 *
 * The AI plugin (plugin-ai) exposes a tools manager on its main class:
 *   app.pm.get('ai').aiManager.ai.toolsManager
 *
 * We call `registerTools([...])` with tool objects shaped like OpenAI-style function tools.
 * If plugin-ai is not enabled, this function is a no-op — the plugin still provides its
 * REST endpoints (see plugin.ts), so any external agent can call the same operations.
 */
export function registerAITools(app: Application): void {
  const aiPlugin: any = safeGet(app, 'ai');
  const toolsManager: any = aiPlugin?.aiManager?.ai?.toolsManager || aiPlugin?.aiManager?.toolsManager;
  if (!toolsManager || typeof toolsManager.registerTools !== 'function') {
    app.logger?.info?.('[noco-tools] plugin-ai not detected; skipping AI tool registration. REST endpoints remain available.');
    return;
  }

  const requireUser = (ctx: any): number => {
    const userId = ctx?.auth?.user?.id ?? ctx?.user?.id ?? ctx?.state?.currentUser?.id;
    if (!userId) throw new Error('AI tool must run in a user-authenticated context.');
    return Number(userId);
  };

  const tools = [
    {
      name: 'google.gmail.listEmails',
      title: 'Gmail — list emails',
      description: 'List recent emails for the current user. Supports a Gmail search query (Gmail search syntax) and maxResults.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query, e.g. `is:unread from:alice@example.com newer_than:7d`.' },
          maxResults: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          labelIds: { type: 'array', items: { type: 'string' }, description: 'Optional label ids to restrict.' },
        },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => gmail.listEmails(app, requireUser(ctx), args || {}),
    },
    {
      name: 'google.gmail.getEmail',
      title: 'Gmail — get email',
      description: 'Fetch a single email by id including headers, text body, and HTML body. Use this to read/summarize an email.',
      parameters: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Gmail message id.' } },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => gmail.getEmail(app, requireUser(ctx), String(args.id)),
    },
    {
      name: 'google.gmail.sendEmail',
      title: 'Gmail — send email',
      description: 'Send an email on behalf of the connected user.',
      parameters: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to: { type: ['string', 'array'], items: { type: 'string' } },
          cc: { type: ['string', 'array'], items: { type: 'string' } },
          bcc: { type: ['string', 'array'], items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
          isHtml: { type: 'boolean', default: false },
          replyToMessageId: { type: 'string' },
        },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => gmail.sendEmail(app, requireUser(ctx), args),
    },
    {
      name: 'google.calendar.listEvents',
      title: 'Calendar — list events',
      description: 'List upcoming events on the user\'s primary calendar (or a specific calendarId).',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string', description: 'Calendar id; defaults to "primary".' },
          timeMin: { type: 'string', description: 'ISO 8601, defaults to now.' },
          timeMax: { type: 'string', description: 'ISO 8601.' },
          q: { type: 'string', description: 'Free-text search across event fields.' },
          maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => calendar.listEvents(app, requireUser(ctx), args || {}),
    },
    {
      name: 'google.calendar.createEvent',
      title: 'Calendar — create event',
      description: 'Create a new event on the user\'s calendar.',
      parameters: {
        type: 'object',
        required: ['summary', 'start', 'end'],
        properties: {
          calendarId: { type: 'string', default: 'primary' },
          summary: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
          start: {
            type: 'object',
            description: 'Either { dateTime, timeZone } for timed events or { date } for all-day.',
          },
          end: { type: 'object' },
          attendees: {
            type: 'array',
            items: {
              type: 'object',
              properties: { email: { type: 'string' }, optional: { type: 'boolean' } },
              required: ['email'],
            },
          },
          sendUpdates: { type: 'string', enum: ['all', 'externalOnly', 'none'], default: 'none' },
        },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => calendar.createEvent(app, requireUser(ctx), args),
    },
    {
      name: 'google.calendar.listSharedEvents',
      title: 'Calendar — list events on shared calendars',
      description: 'List events from calendars shared with the user (excluding their own primary/owned calendars).',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string' },
          timeMax: { type: 'string' },
          q: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
        additionalProperties: false,
      },
      execute: async (args: any, ctx: any) => calendar.listSharedEvents(app, requireUser(ctx), args || {}),
    },
  ];

  try {
    toolsManager.registerTools(tools);
    app.logger?.info?.(`[noco-tools] Registered ${tools.length} AI tools with plugin-ai.`);
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