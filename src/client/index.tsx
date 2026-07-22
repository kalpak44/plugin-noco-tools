import React from 'react';
import { Plugin, useAPIClient } from '@nocobase/client';
import { useTranslation } from 'react-i18next';
import { ConnectionCard } from '../shared/ConnectionCard';
// @ts-ignore
import pkg from '../../package.json';

const NS = pkg.name;

const ConnectGoogleSettingsPage: React.FC = () => {
  const api = useAPIClient();
  const { t } = useTranslation(NS);
  return (
    <div style={{ padding: 24 }}>
      <ConnectionCard api={api} t={t as any} />
    </div>
  );
};

export class PluginNocoToolsV1Client extends Plugin {
  async load() {
    this.app.pluginSettingsManager.add(NS, {
      title: `{{t("Connect Google", { ns: "${NS}" })}}`,
      icon: 'GoogleOutlined',
      Component: ConnectGoogleSettingsPage,
    });
  }
}

export default PluginNocoToolsV1Client;