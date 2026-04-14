import { PipedreamClient } from '@pipedream/sdk/server';
import type { ENV_VARS } from '../env-vars';

export function createPipedreamClient(env: ENV_VARS): PipedreamClient {
  return new PipedreamClient({
    projectId: env.PIPEDREAM_PROJECT_ID,
    projectEnvironment: (env.PIPEDREAM_PROJECT_ENVIRONMENT ??
      'development') as 'development' | 'production',
    clientId: env.PIPEDREAM_CLIENT_ID,
    clientSecret: env.PIPEDREAM_CLIENT_SECRET,
  });
}
