import { InjectionToken } from '@angular/core';

export interface PipedreamConnectConfig {
  /** URL of your token endpoint, e.g. 'http://localhost:3333/api/pipedream/token' */
  tokenEndpointUrl: string;
  /** The external user ID to scope all SDK calls to */
  externalUserId: string;
  /** Base URL for workflow API, e.g. 'http://localhost:8787' */
  apiBaseUrl: string;
  /** Optional: override Pipedream API host (e.g. for staging) */
  apiHost?: string;
}

export const PIPEDREAM_CONFIG = new InjectionToken<PipedreamConnectConfig>(
  'PIPEDREAM_CONFIG'
);
