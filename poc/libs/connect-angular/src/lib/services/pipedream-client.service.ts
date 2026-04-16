import { inject, Injectable } from '@angular/core';
import {
  createFrontendClient,
  ConnectResult,
  ConnectError,
  PipedreamClient,
} from '@pipedream/sdk/browser';
import type { CreateTokenResponse } from '@pipedream/sdk';
import type { ConfigurableProp } from '@pipedream/sdk';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';

/**
 * Angular wrapper around the Pipedream browser SDK.
 *
 * Scope: mirrors what `@pipedream/connect-react` provides — SDK initialization,
 * token acquisition, and read/query operations (apps, components, accounts,
 * props). It is intentionally free of application business logic.
 *
 * What belongs here:
 *   - SDK lifecycle (createFrontendClient, token callback)
 *   - Read/list operations: listApps, getApp, listComponents, getComponent,
 *     listAccounts
 *   - UI-initiating actions: connectAccount (opens the OAuth popup)
 *   - Prop utilities: reloadProps, configureProp, runAction
 *
 * What does NOT belong here:
 *   - Application-specific write operations (deleting accounts, saving
 *     workflows, etc.). Those belong in the feature library that owns that
 *     domain, calling your own backend API directly.
 *   - Any logic tied to a particular app's business rules.
 */
@Injectable({ providedIn: 'root' })
export class PipedreamClientService {
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
    configurableProps: ConfigurableProp[],
    dynamicPropsId?: string,
  ) {
    return this.client.components.reloadProps({
      id: componentKey,
      externalUserId: this.config.externalUserId,
      configuredProps: this.normalizeAppProps(
        configuredProps,
        configurableProps,
      ),
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
    configurableProps: ConfigurableProp[],
    dynamicPropsId?: string,
    query?: string,
  ) {
    return this.client.components.configureProp({
      id: componentKey,
      externalUserId: this.config.externalUserId,
      propName,
      configuredProps: this.normalizeAppProps(
        configuredProps,
        configurableProps,
      ),
      ...(dynamicPropsId ? { dynamicPropsId } : {}),
      ...(query ? { query } : {}),
    });
  }

  /**
   * @deprecated Use reloadProps() instead.
   */
  configureProps(
    componentKey: string,
    configuredProps: Record<string, unknown>,
    configurableProps: ConfigurableProp[],
  ) {
    return this.reloadProps(componentKey, configuredProps, configurableProps);
  }

  // ── Action execution (testing) ────────────────────────────────────────────

  /**
   * Execute (test) an action with the given configured props.
   * Automatically wraps app-type props as `{ authProvisionId }` for the API.
   * Returns the action's exports and return value.
   */
  runAction(
    componentKey: string,
    configuredProps: Record<string, unknown>,
    configurableProps: ConfigurableProp[],
  ) {
    const props = this.normalizeAppProps(configuredProps, configurableProps);

    return this.client.actions.run({
      id: componentKey,
      externalUserId: this.config.externalUserId,
      configuredProps: props,
    });
  }

  /**
   * Wraps bare-string app-type props into `{ authProvisionId: value }` objects
   * as expected by the Pipedream API.
   */
  private normalizeAppProps(
    configuredProps: Record<string, unknown>,
    configurableProps: ConfigurableProp[],
  ): Record<string, unknown> {
    const appPropNames = new Set(
      configurableProps
        .filter((p) => (p as { type: string }).type === 'app')
        .map((p) => p.name),
    );

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(configuredProps)) {
      if (appPropNames.has(key) && typeof value === 'string') {
        result[key] = { authProvisionId: value };
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async fetchToken(_opts: {
    externalUserId: string;
  }): Promise<CreateTokenResponse> {
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
