import type { Application } from '@nocobase/server';
import { ensureFreshAccessToken } from './tokenStore';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';

async function authFetch(app: Application, userId: number | string, path: string, init: RequestInit = {}) {
  const conn = await ensureFreshAccessToken(app, userId);
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }
  return res.json();
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  date?: string;
  unread: boolean;
}

export async function listEmails(
  app: Application,
  userId: number | string,
  opts: { query?: string; maxResults?: number; labelIds?: string[] } = {},
): Promise<EmailSummary[]> {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  if (opts.maxResults) params.set('maxResults', String(Math.min(opts.maxResults, 50)));
  (opts.labelIds || []).forEach((l) => params.append('labelIds', l));

  const list = await authFetch(app, userId, `/users/me/messages?${params.toString()}`);
  const messages = (list.messages || []) as Array<{ id: string; threadId: string }>;
  const details = await Promise.all(
    messages.map((m) =>
      authFetch(app, userId, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
        .then((full) => toSummary(full))
        .catch(() => null),
    ),
  );
  return details.filter(Boolean) as EmailSummary[];
}

export interface EmailDetail extends EmailSummary {
  bodyText?: string;
  bodyHtml?: string;
  headers: Record<string, string>;
}

export async function getEmail(app: Application, userId: number | string, id: string): Promise<EmailDetail> {
  const full = await authFetch(app, userId, `/users/me/messages/${id}?format=full`);
  const summary = toSummary(full);
  const { bodyText, bodyHtml } = extractBodies(full.payload);
  const headers: Record<string, string> = {};
  (full.payload?.headers || []).forEach((h: any) => {
    if (h?.name) headers[h.name.toLowerCase()] = String(h.value ?? '');
  });
  return { ...summary, bodyText, bodyHtml, headers };
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  isHtml?: boolean;
  replyToMessageId?: string;
}

export async function sendEmail(
  app: Application,
  userId: number | string,
  input: SendEmailInput,
): Promise<{ id: string; threadId: string }> {
  const conn = await ensureFreshAccessToken(app, userId);
  const rfc822 = buildRfc822({
    from: conn.googleEmail || 'me',
    to: toAddrList(input.to),
    cc: toAddrList(input.cc),
    bcc: toAddrList(input.bcc),
    subject: input.subject,
    body: input.body,
    isHtml: !!input.isHtml,
    inReplyTo: input.replyToMessageId,
  });
  const raw = Buffer.from(rfc822, 'utf8').toString('base64url');
  const res = await authFetch(app, userId, `/users/me/messages/send`, {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
  return { id: res.id, threadId: res.threadId };
}

function toAddrList(v?: string | string[]) {
  if (!v) return undefined;
  return Array.isArray(v) ? v.join(', ') : v;
}

function toSummary(msg: any): EmailSummary {
  const headers: Record<string, string> = {};
  (msg.payload?.headers || []).forEach((h: any) => {
    if (h?.name) headers[h.name.toLowerCase()] = String(h.value ?? '');
  });
  const labelIds: string[] = msg.labelIds || [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headers['from'],
    to: headers['to'],
    subject: headers['subject'],
    snippet: msg.snippet,
    date: headers['date'],
    unread: labelIds.includes('UNREAD'),
  };
}

function extractBodies(payload: any): { bodyText?: string; bodyHtml?: string } {
  const out: { bodyText?: string; bodyHtml?: string } = {};
  const walk = (part: any) => {
    if (!part) return;
    const mime: string = part.mimeType || '';
    if (part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8');
      if (mime.startsWith('text/plain') && !out.bodyText) out.bodyText = decoded;
      else if (mime.startsWith('text/html') && !out.bodyHtml) out.bodyHtml = decoded;
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

function buildRfc822(input: {
  from: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  isHtml: boolean;
  inReplyTo?: string;
}): string {
  const lines: string[] = [];
  lines.push(`From: ${input.from}`);
  if (input.to) lines.push(`To: ${input.to}`);
  if (input.cc) lines.push(`Cc: ${input.cc}`);
  if (input.bcc) lines.push(`Bcc: ${input.bcc}`);
  lines.push(`Subject: ${encodeHeader(input.subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: ${input.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`);
  lines.push('Content-Transfer-Encoding: 8bit');
  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`);
    lines.push(`References: ${input.inReplyTo}`);
  }
  lines.push('');
  lines.push(input.body);
  return lines.join('\r\n');
}

function encodeHeader(v: string): string {
  return /[^\x20-\x7E]/.test(v) ? `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=` : v;
}