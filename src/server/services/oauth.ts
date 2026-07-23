import crypto from 'crypto';
import type { Application } from '@nocobase/server';
import {
  DEFAULT_SCOPES,
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  resolveGoogleCredentials,
} from './config';

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export interface OAuthState {
  userId: number | string;
  nonce: string;
  ts: number;
}

/** Sign+encode state so we can verify it on the callback. */
export function encodeState(app: Application, payload: OAuthState): string {
  const secret = getStateSecret(app);
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function decodeState(app: Application, token: string): OAuthState {
  const secret = getStateSecret(app);
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Invalid OAuth state');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('OAuth state signature mismatch');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
  const ageMs = Date.now() - Number(payload.ts || 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) {
    throw new Error('OAuth state expired');
  }
  return payload;
}

function getStateSecret(app: Application): string {
  const fromEnv = process.env.APP_KEY || process.env.NOCOBASE_APP_KEY;
  if (fromEnv) return fromEnv;
  const anyApp = app as any;
  return (
    anyApp?.appManager?.appKey ||
    anyApp?.options?.appKey ||
    anyApp?.name ||
    'nocobase-google-oauth-state'
  );
}

export async function buildAuthorizeUrl(
  app: Application,
  userId: number | string,
): Promise<{ url: string; state: string; redirectUri: string }> {
  const { clientId, redirectUri } = await resolveGoogleCredentials(app);
  const state = encodeState(app, { userId, nonce: crypto.randomBytes(12).toString('base64url'), ts: Date.now() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DEFAULT_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, state, redirectUri };
}

export async function exchangeCodeForToken(
  app: Application,
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = await resolveGoogleCredentials(app);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(
  app: Application,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = await resolveGoogleCredentials(app);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleTokenResponse;
}

export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo | undefined> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as GoogleUserInfo;
  } catch {
    return undefined;
  }
}