import { Plugin, Application } from '@nocobase/client-v2';
import GoogleConnectBlockModel from './models/GoogleConnectBlockModel';

export class PluginNocoToolsClient extends Plugin<any, Application> {
  async load() {
    this.flowEngine.registerModelLoaders({
      GoogleConnectBlockModel: {
        loader: () => Promise.resolve({ default: GoogleConnectBlockModel }),
      },
    });
  }
}

export default PluginNocoToolsClient;