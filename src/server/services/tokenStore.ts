import type { Application } from '@nocobase/server';
import { refreshAccessToken } from './oauth';

export interface StoredConnection {
  id: number;
  userId: number;
  googleEmail?: string;
  googleSub?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string;
  tokenType?: string;
  status?: string;
  lastError?: string | null;
}

const REFRESH_SKEW_MS = 60_000;

export async function getConnection(app: Application, userId: number | string): Promise<StoredConnection | null> {
  const repo = app.db.getRepository('googleConnections');
  const row = await repo.findOne({ filter: { userId } });
  if (!row) return null;
  return normalize(row);
}

export async function saveConnection(
  app: Application,
  userId: number | string,
  patch: Partial<StoredConnection>,
): Promise<StoredConnection> {
  const repo = app.db.getRepository('googleConnections');
  const existing = await repo.findOne({ filter: { userId } });
  const values = { ...patch, userId };
  const row = existing
    ? await repo.update({ filterByTk: existing.id, values })
    : await repo.create({ values });
  const persisted = Array.isArray(row) ? row[0] : row;
  return normalize(persisted);
}

export async function deleteConnection(app: Application, userId: number | string): Promise<void> {
  const repo = app.db.getRepository('googleConnections');
  await repo.destroy({ filter: { userId } });
}

/**
 * Return a currently-valid access token for the given user, refreshing it via
 * the stored refresh_token if the current one is expired or within the skew window.
 */
export async function ensureFreshAccessToken(
  app: Application,
  userId: number | string,
): Promise<StoredConnection> {
  const conn = await getConnection(app, userId);
  if (!conn) throw new Error('Google account not connected for this user.');

  const now = Date.now();
  const expiresAtMs = conn.expiresAt instanceof Date ? conn.expiresAt.getTime() : new Date(conn.expiresAt).getTime();
  if (expiresAtMs - now > REFRESH_SKEW_MS && conn.status !== 'revoked') {
    return conn;
  }

  try {
    const refreshed = await refreshAccessToken(app, conn.refreshToken);
    const updated = await saveConnection(app, userId, {
      accessToken: refreshed.access_token,
      expiresAt: new Date(now + refreshed.expires_in * 1000),
      // Google normally does NOT return refresh_token on refresh; keep the existing one.
      refreshToken: refreshed.refresh_token || conn.refreshToken,
      scope: refreshed.scope || conn.scope,
      tokenType: refreshed.token_type || conn.tokenType,
      status: 'active',
      lastError: null,
    });
    return updated;
  } catch (err: any) {
    await saveConnection(app, userId, { status: 'error', lastError: String(err?.message || err) });
    throw err;
  }
}

function normalize(row: any): StoredConnection {
  return {
    id: row.id,
    userId: row.userId,
    googleEmail: row.googleEmail,
    googleSub: row.googleSub,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt),
    scope: row.scope,
    tokenType: row.tokenType,
    status: row.status,
    lastError: row.lastError,
  };
}