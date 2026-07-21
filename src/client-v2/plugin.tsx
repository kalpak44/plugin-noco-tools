import { Plugin, Application } from '@nocobase/client-v2';

export class PluginNocoToolsClient extends Plugin<any, Application> {
  async load() {
    this.flowEngine.registerModelLoaders({
      GoogleConnectBlockModel: {
        loader: () => import('./models/GoogleConnectBlockModel'),
      },
    });
  }
}

export default PluginNocoToolsClient;