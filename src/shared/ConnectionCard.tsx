import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, message as antdMessage } from 'antd';

interface ConnectionStatus {
  connected: boolean;
  status: string;
  googleEmail?: string;
  scopes?: string[];
  expiresAt?: string;
  lastError?: string;
}

export interface ApiLike {
  request: (opts: { url: string; method: 'get' | 'post' }) => Promise<any>;
}

export type Translator = (str: string, options?: Record<string, unknown>) => string;

export interface ConnectionCardProps {
  api: ApiLike;
  t: Translator;
  title?: string;
  showScopes?: boolean;
}

const GoogleLogo: React.FC = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const IconMail: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="M2 8l10 6 10-6"/>
  </svg>
);

const IconCalendar: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
  </svg>
);

const IconPlug: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5"/>
    <path d="M9 8V2"/>
    <path d="M15 8V2"/>
    <path d="M18 8H6a1 1 0 00-1 1v3a5 5 0 0010 0V9a1 1 0 00-1-1z"/>
  </svg>
);

const IconUnlink: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
  </svg>
);

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  api,
  t,
}) => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [popupWarning, setPopupWarning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.request({ url: 'googleConnections:status', method: 'get' });
      setStatus(res?.data?.data || { connected: false, status: 'not_connected' });
    } catch (err: any) {
      setStatus({ connected: false, status: 'error', lastError: err?.message });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startConnect = useCallback(async () => {
    setBusy(true);
    setPopupWarning(null);
    try {
      const authRes = await api.request({ url: 'googleConnections:authorize', method: 'post' });
      const url = authRes?.data?.data?.authorizeUrl;
      if (!url) throw new Error('No authorizeUrl returned by server.');

      const width = 520;
      const height = 640;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      const popup = window.open(
        url,
        'nocobase-google-oauth',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`,
      );
      if (!popup) {
        setPopupWarning(t('Failed to start connection: {{message}}', { message: 'popup blocked' }));
        return;
      }

      const done = await new Promise<{ status: 'success' | 'error'; email?: string; message?: string }>((resolve) => {
        let settled = false;
        const onMessage = (ev: MessageEvent) => {
          const d: any = ev?.data;
          if (!d || d.source !== 'nocobase-google-oauth') return;
          settled = true;
          window.removeEventListener('message', onMessage);
          clearInterval(pollClose);
          resolve({ status: d.status, email: d.email, message: d.message });
        };
        window.addEventListener('message', onMessage);
        const pollClose = setInterval(() => {
          if (popup.closed && !settled) {
            settled = true;
            window.removeEventListener('message', onMessage);
            clearInterval(pollClose);
            resolve({ status: 'error', message: t('Connection window closed before completion. Please try again.') });
          }
        }, 500);
      });

      if (done.status === 'success') {
        antdMessage.success(t('Google account connected.'));
      } else if (done.message) {
        antdMessage.error(done.message);
      }
    } catch (err: any) {
      antdMessage.error(t('Failed to start connection: {{message}}', { message: err?.message || String(err) }));
    } finally {
      setBusy(false);
      refresh();
    }
  }, [api, refresh, t]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await api.request({ url: 'googleConnections:disconnect', method: 'post' });
      antdMessage.success(t('Google account disconnected.'));
    } catch (err: any) {
      antdMessage.error(t('Failed to disconnect: {{message}}', { message: err?.message || String(err) }));
    } finally {
      setBusy(false);
      refresh();
    }
  }, [api, refresh, t]);

  const connected = !!status?.connected;

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ color: '#999', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* Status badge */}
      <div style={{
        position: 'absolute',
        top: 24,
        right: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        background: connected ? 'rgba(52,199,89,0.13)' : '#EBEBEB',
        borderRadius: 999,
        padding: '6px 16px',
        fontSize: 14,
        fontWeight: 600,
        color: connected ? '#1A8A3C' : '#8A8A8A',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
          background: connected ? '#34C759' : '#ABABAB',
        }} />
        {connected ? t('Connected') : t('Not connected')}
      </div>

      {/* Header row: Google logo + title + description */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 24 }}>
        <div style={{
          width: 72, height: 72, flexShrink: 0,
          background: '#fff',
          border: '1.5px solid #E4E4E4',
          borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <GoogleLogo />
        </div>
        <div style={{ paddingTop: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111', lineHeight: 1.25, marginBottom: 6 }}>
            Google Workspace
          </div>
          <div style={{ fontSize: 15, color: '#666', lineHeight: 1.55 }}>
            {t('Allows AI employee access to Gmail and Google Calendar.')}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {status?.lastError && (
        <Alert type="warning" showIcon message={status.lastError} style={{ marginBottom: 16, borderRadius: 10 }} />
      )}
      {popupWarning && (
        <Alert type="warning" showIcon message={popupWarning} style={{ marginBottom: 16, borderRadius: 10 }} />
      )}

      {/* Connected email */}
      {connected && status?.googleEmail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <IconMail size={18} color="#555" />
          <span style={{
            background: '#EBEBEB',
            borderRadius: 8,
            padding: '5px 14px',
            fontSize: 14,
            fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
            color: '#333',
            fontWeight: 500,
          }}>
            {status.googleEmail}
          </span>
        </div>
      )}

      {/* Service pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <div style={pillStyle}>
          <IconMail size={15} />
          Gmail
        </div>
        <div style={pillStyle}>
          <IconCalendar size={15} />
          Calendar
        </div>
      </div>

      {/* Action button */}
      {connected ? (
        <Button
          onClick={disconnect}
          loading={busy}
          style={disconnectBtnStyle}
          icon={<IconUnlink />}
        >
          {t('Disconnect')}
        </Button>
      ) : (
        <Button
          onClick={startConnect}
          loading={busy}
          style={connectBtnStyle}
          icon={<IconPlug />}
        >
          {busy ? t('Connecting…') : t('Connect')}
        </Button>
      )}
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  position: 'relative',
  background: '#F8F9FA',
  border: '1.5px solid #E4E4E4',
  borderRadius: 20,
  padding: '28px 32px 32px',
  maxWidth: 660,
};

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: '#EBEBEB',
  borderRadius: 999,
  padding: '8px 18px',
  fontSize: 14,
  fontWeight: 600,
  color: '#444',
};

const connectBtnStyle: React.CSSProperties = {
  height: 54,
  paddingInline: 36,
  borderRadius: 14,
  fontSize: 16,
  fontWeight: 700,
  background: '#7C3AED',
  borderColor: '#7C3AED',
  color: '#fff',
  boxShadow: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const disconnectBtnStyle: React.CSSProperties = {
  height: 54,
  paddingInline: 36,
  borderRadius: 14,
  fontSize: 16,
  fontWeight: 700,
  background: '#fff',
  borderColor: '#D0D0D0',
  color: '#333',
  boxShadow: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

export default ConnectionCard;