import type { Application } from '@nocobase/server';

// Must stay in sync with the scopes registered on the Google Cloud OAuth
// client (Google Auth Platform → Data Access). Requesting a scope that is not
// registered there fails the consent flow; registering one that is never
// requested is an over-broad grant that Google's restricted-scope review and
// a CASA assessor will both flag. Each entry below maps to a shipped AI tool:
//
//   gmail.readonly  → googleGmailListEmails, googleGmailGetEmail
//   gmail.send      → googleGmailSendEmail
//   calendar        → googleCalendar{ListCalendars,ListEvents,CreateEvent,
//                     UpdateEvent,DeleteEvent,ListSharedEvents}
//
// Adding a tool that needs broader authority means registering the scope in
// the Cloud console first, and updating README.md + site/privacy.html.
export const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
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

export async function resolveGoogleCredentials(app: Application): Promise<GoogleClientCredentials> {
  const vars = readEnv(app);

  const clientId =
    vars['google_client_id'] ||
    vars['GOOGLE_CLIENT_ID'] ||
    process.env.GOOGLE_CLIENT_ID;

  const clientSecret =
    vars['google_client_secret'] ||
    vars['GOOGLE_CLIENT_SECRET'] ||
    process.env.GOOGLE_CLIENT_SECRET;

  const redirectUri =
    vars['google_redirect_uri'] ||
    vars['GOOGLE_REDIRECT_URI'] ||
    process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth credentials not configured. Define Variable `google_client_id` and Secret `google_client_secret` in NocoBase → Settings → Variables and secrets (or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars).',
    );
  }

  if (!redirectUri) {
    throw new Error(
      'Google OAuth redirect URI not configured. Define Variable `google_redirect_uri` in NocoBase → Settings → Variables and secrets (e.g. `https://your-nocobase.example.com/api/googleConnections:callback`), or set GOOGLE_REDIRECT_URI. The value must match the Authorized redirect URI in your Google Cloud OAuth client.',
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function readEnv(app: Application): Record<string, string> {
  const env: any = (app as any).environment;
  if (env && typeof env.getVariables === 'function') return env.getVariables() || {};
  return {};
}