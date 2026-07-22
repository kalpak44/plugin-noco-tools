import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Tooltip, Typography, message as antdMessage } from 'antd';

const { Text, Paragraph } = Typography;

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

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  api,
  t,
  title = '',
  showScopes = true,
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

  return (
    <Card
      loading={loading}
      title={<Space><span role="img" aria-label="google">🔗</span><span>{title || t('Connect Google Account')}</span></Space>}
      extra={
        connected ? (
          <Tag color="green">{t('Connected')}</Tag>
        ) : (
          <Tag color="default">{t('Not connected')}</Tag>
        )
      }
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t(
          'Connect your Google account to let AI employees read and summarize your emails, send emails on your behalf, view your calendar events, create events, and check events on calendars shared with you.',
        )}
      </Paragraph>

      {status?.lastError && (
        <Alert
          type="warning"
          showIcon
          message={status.lastError}
          style={{ marginBottom: 16 }}
        />
      )}

      {popupWarning && (
        <Alert type="warning" showIcon message={popupWarning} style={{ marginBottom: 16 }} />
      )}

      {connected ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text strong>{t('Connected as {{email}}', { email: status?.googleEmail || '—' })}</Text>
          {showScopes && status?.scopes?.length ? (
            <div>
              <Text type="secondary">{t('Scopes granted')}:</Text>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {status.scopes.map((s) => (
                  <Tag key={s} bordered={false}>{s}</Tag>
                ))}
              </div>
            </div>
          ) : null}
          <Space>
            <Tooltip title={t('Reconnect')}>
              <Button onClick={startConnect} loading={busy}>{t('Reconnect')}</Button>
            </Tooltip>
            <Button danger onClick={disconnect} loading={busy}>{t('Disconnect')}</Button>
          </Space>
        </Space>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Button type="primary" size="large" onClick={startConnect} loading={busy}>
            {busy ? t('Connecting…') : t('Connect Google')}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('This page shows configuration state for the currently logged-in user.')}
          </Text>
        </Space>
      )}
    </Card>
  );
};

export default ConnectionCard;