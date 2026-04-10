import { inject, Injectable, OnDestroy } from '@angular/core';
import {
  createFrontendClient,
  ConnectResult,
  ConnectError,
  PipedreamClient,
} from '@pipedream/sdk/browser';
import type { CreateTokenResponse } from '@pipedream/sdk';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';

@Injectable({ providedIn: 'root' })
export class PipedreamClientService implements OnDestroy {
  private readonly config = inject(PIPEDREAM_CONFIG);
  private client: PipedreamClient;

  constructor() {
    this.client = createFrontendClient({
      externalUserId: this.config.externalUserId,
      tokenCallback: (opts) =>
        new Promise<CreateTokenResponse>((resolve, reject) => {
          // Deferred so it never runs inside Angular's rendering cycle
          setTimeout(() => {
            this.fetchToken(opts).then(resolve, reject);
          }, 0);
        }),
      ...(this.config.apiHost ? { apiHost: this.config.apiHost } : {}),
    });
  }

  /** Raw SDK client — use only when the helper methods below aren't enough */
  get raw(): PipedreamClient {
    return this.client;
  }

  // ── Apps ──────────────────────────────────────────────────────────────────

  listApps(query?: string, limit = 20) {
    return this.client.apps.list({ q: query, limit });
  }

  getApp(nameSlug: string) {
    return this.client.apps.retrieve(nameSlug);
  }

  // ── Components ────────────────────────────────────────────────────────────

  listComponents(options: {
    app?: string;
    componentType?: 'action' | 'trigger';
    limit?: number;
  }) {
    return this.client.components.list({
      app: options.app,
      componentType: options.componentType,
      limit: options.limit ?? 20,
    });
  }

  getComponent(key: string) {
    return this.client.components.retrieve(key);
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  listAccounts(app?: string) {
    return this.client.accounts.list({
      externalUserId: this.config.externalUserId,
      ...(app ? { app } : {}),
    });
  }

  // ── OAuth account connection ───────────────────────────────────────────────

  connectAccount(app: string): Promise<ConnectResult> {
    return new Promise((resolve, reject) => {
      this.client.connectAccount({
        app,
        onSuccess: (result: ConnectResult) => resolve(result),
        onError: (err: ConnectError) => reject(err),
      });
    });
  }

  // ── Dynamic props ─────────────────────────────────────────────────────────

  /**
   * Re-fetches component props based on currently configured values.
   * Called when a prop with `reloadProps: true` changes.
   */
  reloadProps(
    componentKey: string,
    configuredProps: Record<string, unknown>,
    dynamicPropsId?: string,
  ) {
    return this.client.components.reloadProps({
      id: componentKey,
      externalUserId: this.config.externalUserId,
      configuredProps,
      ...(dynamicPropsId ? { dynamicPropsId } : {}),
    });
  }

  /**
   * Retrieves remote options for a specific prop.
   * Called for props with `remoteOptions: true`.
   */
  configureProp(
    componentKey: string,
    propName: string,
    configuredProps: Record<string, unknown>,
    dynamicPropsId?: string,
    query?: string,
  ) {
    return this.client.components.configureProp({
      id: componentKey,
      externalUserId: this.config.externalUserId,
      propName,
      configuredProps,
      ...(dynamicPropsId ? { dynamicPropsId } : {}),
      ...(query ? { query } : {}),
    });
  }

  /**
   * @deprecated Use reloadProps() instead.
   */
  configureProps(componentKey: string, configuredProps: Record<string, unknown>) {
    return this.reloadProps(componentKey, configuredProps);
  }

  ngOnDestroy(): void {
    // FrontendClient does not require explicit cleanup currently
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async fetchToken(_opts: { externalUserId: string }): Promise<CreateTokenResponse> {
    const response = await fetch(this.config.tokenEndpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.config.externalUserId }),
    });
    if (!response.ok) {
      throw new Error(`Token fetch failed: ${response.status}`);
    }
    return response.json();
  }
}
