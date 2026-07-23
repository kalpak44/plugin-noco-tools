import { Plugin } from '@nocobase/server';
import * as calendar from './services/calendar';
import { resolveGoogleCredentials } from './services/config';
import * as gmail from './services/gmail';
import {
  buildAuthorizeUrl,
  decodeState,
  exchangeCodeForToken,
  fetchUserInfo,
  revokeToken,
} from './services/oauth';
import { decryptSecret } from './services/crypto';
import { deleteConnection, getConnection, saveConnection } from './services/tokenStore';
import { registerAITools } from './ai-tools';

const CALLBACK_HTML = (payload: {
  status: 'success' | 'error';
  email?: string;
  message?: string;
}) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Google connection</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f6f8fa;color:#111;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:32px;max-width:420px;text-align:center}
h1{margin:0 0 8px;font-size:20px}
p{margin:0 0 16px;color:#555}
.ok{color:#16a34a}.err{color:#b91c1c}</style>
</head><body>
<div class="card">
  <h1 class="${payload.status === 'success' ? 'ok' : 'err'}">
    ${payload.status === 'success' ? 'Google account connected' : 'Connection failed'}
  </h1>
  <p>${payload.email ? `Signed in as <b>${escapeHtml(payload.email)}</b>.` : ''}${payload.message ? escapeHtml(payload.message) : ''}</p>
  <p>You can close this window.</p>
</div>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify({ source: 'nocobase-google-oauth', ...payload })}, '*');
    }
  } catch (e) {}
  setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
</script>
</body></html>`;

function escapeHtml(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function requireUserId(ctx: any): number {
  const userId = ctx?.auth?.user?.id ?? ctx?.state?.currentUser?.id ?? ctx?.state?.user?.id;
  if (!userId) ctx.throw?.(401, 'Not authenticated');
  return Number(userId);
}

export class PluginNocoToolsServer extends Plugin {
  async load() {
    // ------------------------------------------------------------------
    // ACL — permissive for the block/status/disconnect actions, public
    // for the OAuth redirect callback (Google → callback URL, no auth).
    // ------------------------------------------------------------------
    this.app.acl.allow('googleConnections', ['authorize', 'status', 'disconnect'], 'loggedIn');
    this.app.acl.allow('googleConnections', 'callback', 'public');
    this.app.acl.allow('googleTools', '*', 'loggedIn');

    // ------------------------------------------------------------------
    // Connection resource — start/callback/status/disconnect
    // ------------------------------------------------------------------
    this.app.resourceManager.registerActionHandlers({
      'googleConnections:authorize': async (ctx, next) => {
        const userId = requireUserId(ctx);
        const { url, redirectUri } = await buildAuthorizeUrl(this.app, userId);
        ctx.body = { authorizeUrl: url, redirectUri };
        await next();
      },

      'googleConnections:status': async (ctx, next) => {
        const userId = requireUserId(ctx);
        const conn = await getConnection(this.app, userId);
        ctx.body = conn
          ? {
              connected: conn.status === 'active',
              status: conn.status,
              googleEmail: conn.googleEmail,
              scopes: conn.scope ? conn.scope.split(/\s+/).filter(Boolean) : [],
              expiresAt: conn.expiresAt,
              lastError: conn.lastError,
            }
          : { connected: false, status: 'not_connected', scopes: [] };
        await next();
      },

      'googleConnections:disconnect': async (ctx, next) => {
        const userId = requireUserId(ctx);
        const conn = await getConnection(this.app, userId);
        if (conn) {
          await revokeToken(conn.refreshToken).catch(() => undefined);
          await revokeToken(conn.accessToken).catch(() => undefined);
          await deleteConnection(this.app, userId);
        }
        ctx.body = { connected: false };
        await next();
      },

      // Public: Google redirects the browser here with ?code&state.
      'googleConnections:callback': async (ctx, next) => {
        ctx.type = 'html';
        // Skip NocoBase's dataWrapping middleware — the OAuth popup needs
        // raw HTML to run its postMessage + window.close script.
        (ctx as any).withoutDataWrapping = true;
        try {
          const { code, state, error, error_description } = ctx.action.params || (ctx.request as any).query || {};
          if (error) throw new Error(`${error}: ${error_description || ''}`);
          if (!code || !state) throw new Error('Missing code or state');

          const decoded = decodeState(this.app, String(state));
          const token = await exchangeCodeForToken(this.app, String(code));
          if (!token.refresh_token) {
            // On repeat consent Google may omit refresh_token; require prompt=consent, which we already set.
            // If missing, tell the user to re-consent from Google account permissions.
            throw new Error(
              'No refresh_token returned by Google. Revoke this app in your Google Account and try connecting again.',
            );
          }
          const userInfo = await fetchUserInfo(token.access_token);

          await saveConnection(this.app, decoded.userId, {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: new Date(Date.now() + token.expires_in * 1000),
            scope: token.scope,
            tokenType: token.token_type,
            googleEmail: userInfo?.email,
            googleSub: userInfo?.sub,
            status: 'active',
            lastError: null,
          });

          ctx.body = CALLBACK_HTML({ status: 'success', email: userInfo?.email });
        } catch (err: any) {
          this.app.logger?.warn?.(`[noco-tools] OAuth callback error: ${err?.message || err}`);
          ctx.body = CALLBACK_HTML({ status: 'error', message: err?.message || 'Unknown error' });
        }
        await next();
      },
    });

    // ------------------------------------------------------------------
    // AI-callable REST endpoints — thin wrappers around service helpers
    // so any HTTP client (including external agents) can call them.
    // ------------------------------------------------------------------
    this.app.resourceManager.define({
      name: 'googleTools',
      actions: {
        listEmails: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          ctx.body = await gmail.listEmails(this.app, userId, values || {});
          await next();
        },
        getEmail: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          if (!values?.id) ctx.throw(400, 'Missing `id`');
          ctx.body = await gmail.getEmail(this.app, userId, values.id);
          await next();
        },
        sendEmail: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          if (!values?.to || !values?.subject || !values?.body) ctx.throw(400, 'Missing required fields: to, subject, body');
          ctx.body = await gmail.sendEmail(this.app, userId, values);
          await next();
        },
        listCalendars: async (ctx, next) => {
          const userId = requireUserId(ctx);
          ctx.body = await calendar.listCalendars(this.app, userId);
          await next();
        },
        listEvents: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          ctx.body = await calendar.listEvents(this.app, userId, values || {});
          await next();
        },
        createEvent: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          if (!values?.summary || !values?.start || !values?.end) ctx.throw(400, 'Missing required fields: summary, start, end');
          ctx.body = await calendar.createEvent(this.app, userId, values);
          await next();
        },
        listSharedEvents: async (ctx, next) => {
          const userId = requireUserId(ctx);
          const { values } = ctx.action.params;
          ctx.body = await calendar.listSharedEvents(this.app, userId, values || {});
          await next();
        },
        configStatus: async (ctx, next) => {
          try {
            const creds = await resolveGoogleCredentials(this.app);
            ctx.body = { configured: true, redirectUri: creds.redirectUri, clientIdSuffix: creds.clientId.slice(-6) };
          } catch (err: any) {
            ctx.body = { configured: false, message: err?.message || String(err) };
          }
          await next();
        },
      },
    });

    // ------------------------------------------------------------------
    // Register AI tools (no-op if plugin-ai is not enabled).
    // ------------------------------------------------------------------
    registerAITools(this.app);
  }

  async afterDisable() {
    // Privacy-conservative: revoke and drop stored tokens on disable.
    await this.wipeAllConnections('afterDisable');
  }

  async remove() {
    await this.wipeAllConnections('remove');
  }

  private async wipeAllConnections(reason: string) {
    try {
      const repo = this.app.db.getRepository('googleConnections');
      if (!repo) return;
      const rows = await repo.find();
      for (const row of rows) {
        await revokeToken(decryptSecret(row.refreshToken)).catch(() => undefined);
        await revokeToken(row.accessToken).catch(() => undefined);
      }
      await repo.destroy({ truncate: true } as any).catch(async () => {
        await repo.destroy({ filter: {} });
      });
      this.app.logger?.info?.(`[noco-tools] Cleared ${rows.length} Google connection(s) on ${reason}.`);
    } catch (err: any) {
      this.app.logger?.warn?.(`[noco-tools] Failed to clear connections on ${reason}: ${err?.message || err}`);
    }
  }
}

export default PluginNocoToolsServer;