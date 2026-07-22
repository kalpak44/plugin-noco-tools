import React from 'react';
import { BlockModel } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { ConnectionCard } from '../../shared/ConnectionCard';
import { tExpr, useT } from '../locale';

const ConnectionCardV2: React.FC<{ title: string; showScopes: boolean }> = ({ title, showScopes }) => {
  const t = useT();
  const { api } = useFlowContext();
  return <ConnectionCard api={api} t={t} title={title} showScopes={showScopes} />;
};

export class GoogleConnectBlockModel extends BlockModel {
  renderComponent() {
    const title = (this.props?.title as string) || '';
    const showScopes = this.props?.showScopes !== false;
    return <ConnectionCardV2 title={title} showScopes={showScopes} />;
  }
}

GoogleConnectBlockModel.define({
  label: tExpr('Connect Google'),
  group: 'others',
});

GoogleConnectBlockModel.registerFlow({
  key: 'googleConnectBlockSettings',
  title: tExpr('Google Connect settings'),
  on: 'beforeRender',
  steps: {
    setup: {
      title: tExpr('Google Connect settings'),
      uiSchema: {
        title: {
          type: 'string',
          title: tExpr('Card title'),
          'x-decorator': 'FormItem',
          'x-component': 'Input',
        },
        showScopes: {
          type: 'boolean',
          title: tExpr('Show scopes'),
          'x-decorator': 'FormItem',
          'x-component': 'Switch',
        },
      },
      defaultParams: {
        title: '',
        showScopes: true,
      },
      handler(ctx, params) {
        ctx.model.props.title = params.title;
        ctx.model.props.showScopes = params.showScopes;
      },
    },
  },
});

export default GoogleConnectBlockModel;