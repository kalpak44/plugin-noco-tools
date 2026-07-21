import type { Application } from '@nocobase/server';

export const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Resolve Google OAuth credentials from NocoBase Variables & Secrets (plugin-environment-variables)
 * with a defensive fallback to process.env so the plugin still functions in local dev
 * where the environment plugin may not be enabled.
 */
export async function resolveGoogleCredentials(
  app: Application,
  ctx?: { request?: { origin?: string; header?: any }; origin?: string } | any,
): Promise<GoogleClientCredentials> {
  const env: any = (app as any).environment;

  const readVar = (name: string): string | undefined => {
    if (!env) return undefined;
    if (typeof env.getVariable === 'function') return env.getVariable(name);
    if (typeof env.get === 'function') return env.get(name);
    return undefined;
  };
  const readSecret = (name: string): string | undefined => {
    if (!env) return undefined;
    if (typeof env.getSecret === 'function') return env.getSecret(name);
    if (typeof env.getVariable === 'function') return env.getVariable(name);
    return undefined;
  };

  const clientId =
    readVar('google_client_id') ||
    readVar('GOOGLE_CLIENT_ID') ||
    process.env.GOOGLE_CLIENT_ID;

  const clientSecret =
    readSecret('google_client_secret') ||
    readSecret('GOOGLE_CLIENT_SECRET') ||
    process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth credentials not configured. Define Variable `google_client_id` and Secret `google_client_secret` in NocoBase → Settings → Variables and secrets (or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars).',
    );
  }

  const explicitRedirect =
    readVar('google_redirect_uri') ||
    readVar('GOOGLE_REDIRECT_URI') ||
    process.env.GOOGLE_REDIRECT_URI;

  const redirectUri = explicitRedirect || deriveRedirectUri(app, ctx);

  return { clientId, clientSecret, redirectUri };
}

function deriveRedirectUri(app: Application, ctx?: any): string {
  const env: any = (app as any).environment;
  const readVar = (name: string): string | undefined => {
    if (!env) return undefined;
    if (typeof env.getVariable === 'function') return env.getVariable(name);
    if (typeof env.get === 'function') return env.get(name);
    return undefined;
  };
  const appPublicUrl =
    readVar('app_public_url') ||
    readVar('APP_PUBLIC_URL') ||
    process.env.APP_PUBLIC_URL ||
    process.env.API_BASE_URL;

  const fromReq =
    ctx?.request?.origin ||
    ctx?.origin ||
    (ctx?.request?.header?.origin as string | undefined) ||
    (ctx?.request?.header?.referer
      ? new URL(ctx.request.header.referer as string).origin
      : undefined);

  const base = (appPublicUrl || fromReq || 'http://localhost:13000').replace(/\/+$/, '');
  // NocoBase mounts REST resources under /api/<resource>:<action>
  return `${base}/api/googleConnections:callback`;
}