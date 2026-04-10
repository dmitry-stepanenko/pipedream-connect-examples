# PLAN-02 — connect-angular: Core Services & DI Tokens

## Goal

Build the foundation of the `@poc/connect-angular` library:
- Injection tokens for configuration and custom triggers
- `provideConnectAngular()` setup function
- `PipedreamClientService` wrapping `@pipedream/sdk`

This is the base all other components depend on.

## Context

- Library path: `poc/libs/connect-angular/src/`
- Path alias: `@poc/connect-angular` (defined in `poc/tsconfig.base.json`)
- Entry point: `poc/libs/connect-angular/src/index.ts` — currently exports one stub component
- React reference: read `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/hooks/frontend-client-context.tsx` for how `FrontendClientProvider` and `useFrontendClient()` are implemented
- React usage reference: `connect-react-demo/src/` — see `ClientWrapper.tsx` and `FrontendClientProvider` usage
- Angular 21 — standalone components, `inject()`, signals, no NgModules
- `@pipedream/sdk` must already be installed (PLAN-01 adds it to `poc/package.json`)

## Prerequisites

PLAN-01 must be completed (so `@pipedream/sdk` is in `poc/package.json`).

## File Structure to Create

```
poc/libs/connect-angular/src/lib/
├── tokens/
│   ├── pipedream-config.token.ts
│   └── custom-triggers.token.ts
├── models/
│   └── custom-trigger.model.ts
├── services/
│   └── pipedream-client.service.ts
└── provide-connect-angular.ts
```

Update `poc/libs/connect-angular/src/index.ts` to export everything.

---

## Step 1 — Define the `CustomTrigger` model

Create `poc/libs/connect-angular/src/lib/models/custom-trigger.model.ts`:

```typescript
/** JSON Schema subset — enough to describe trigger payload fields */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * An internal business event that can trigger a workflow.
 * Registered by consuming apps via provideCustomTriggers().
 *
 * Example: { id: 'order.created', name: 'Order Created', payloadSchema: { ... } }
 */
export interface CustomTrigger {
  id: string;
  name: string;
  description: string;
  /** Optional icon name or URL */
  icon?: string;
  /** Describes the shape of the event payload; used for variable picking in later steps */
  payloadSchema: JsonSchema;
}
```

---

## Step 2 — Define injection tokens

Create `poc/libs/connect-angular/src/lib/tokens/pipedream-config.token.ts`:

```typescript
import { InjectionToken } from '@angular/core';

export interface PipedreamConnectConfig {
  /** URL of your token endpoint, e.g. 'http://localhost:3333/api/pipedream/token' */
  tokenEndpointUrl: string;
  /** The external user ID to scope all SDK calls to */
  externalUserId: string;
  /** Optional: override Pipedream API host (e.g. for staging) */
  apiHost?: string;
}

export const PIPEDREAM_CONFIG = new InjectionToken<PipedreamConnectConfig>(
  'PIPEDREAM_CONFIG'
);
```

Create `poc/libs/connect-angular/src/lib/tokens/custom-triggers.token.ts`:

```typescript
import { InjectionToken, Provider } from '@angular/core';
import { CustomTrigger } from '../models/custom-trigger.model';

export const CUSTOM_TRIGGERS = new InjectionToken<CustomTrigger[]>(
  'CUSTOM_TRIGGERS',
  { factory: () => [] }
);

/** Register your app's internal triggers with the workflow builder */
export function provideCustomTriggers(triggers: CustomTrigger[]): Provider {
  return { provide: CUSTOM_TRIGGERS, useValue: triggers };
}
```

---

## Step 3 — Create `PipedreamClientService`

Create `poc/libs/connect-angular/src/lib/services/pipedream-client.service.ts`:

```typescript
import { inject, Injectable, OnDestroy } from '@angular/core';
import { createFrontendClient, FrontendClient } from '@pipedream/sdk/browser';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';

@Injectable({ providedIn: 'root' })
export class PipedreamClientService implements OnDestroy {
  private readonly config = inject(PIPEDREAM_CONFIG);
  private client: FrontendClient;

  constructor() {
    this.client = createFrontendClient({
      externalUserId: this.config.externalUserId,
      tokenCallback: (opts) =>
        new Promise((resolve, reject) => {
          // Deferred so it never runs inside Angular's rendering cycle
          setTimeout(() => {
            this.fetchToken(opts).then(resolve, reject);
          }, 0);
        }),
      ...(this.config.apiHost ? { apiHost: this.config.apiHost } : {}),
    });
  }

  /** Raw SDK client — use only when the helper methods below aren't enough */
  get raw(): FrontendClient {
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
      type: options.componentType,
      limit: options.limit ?? 20,
    });
  }

  getComponent(key: string) {
    return this.client.components.retrieve(key);
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  listAccounts(app?: string) {
    return this.client.accounts.list({
      external_user_id: this.config.externalUserId,
      ...(app ? { app } : {}),
    });
  }

  // ── OAuth account connection ───────────────────────────────────────────────

  connectAccount(app: string): Promise<{ id: string }> {
    return new Promise((resolve, reject) => {
      this.client.connectAccount({
        app,
        onSuccess: (result) => resolve(result),
        onError: (err) => reject(err),
      });
    });
  }

  // ── Dynamic props ─────────────────────────────────────────────────────────

  /**
   * Re-fetches component props based on currently configured values.
   * Called when a prop with `reloadProps: true` changes.
   *
   * NOTE: Check the exact SDK method signature against @pipedream/sdk types.
   * Look for: client.components.configureProps() or similar.
   * Reference: connect-react-demo node_modules/@pipedream/sdk/dist/
   */
  configureProps(componentKey: string, configuredProps: Record<string, unknown>) {
    // TODO: verify exact method name from SDK types
    // Likely: this.client.components.configureProps({ key: componentKey, configuredProps })
    // Or: this.client.props.list({ componentKey, configuredProps })
    throw new Error('Implement after checking @pipedream/sdk types for dynamic props API');
  }

  ngOnDestroy(): void {
    // FrontendClient does not require explicit cleanup currently
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async fetchToken(_opts: unknown): Promise<unknown> {
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
```

> **Important**: The `configureProps` method body needs to be completed by looking at the actual `@pipedream/sdk` types once installed. Check `poc/node_modules/@pipedream/sdk/dist/` or the SDK's TypeScript declarations for the correct method. In `connect-react-demo`, look at how `ComponentForm` fetches dynamic props internally.

---

## Step 4 — Create `provideConnectAngular()`

Create `poc/libs/connect-angular/src/lib/provide-connect-angular.ts`:

```typescript
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { PIPEDREAM_CONFIG, PipedreamConnectConfig } from './tokens/pipedream-config.token';

/**
 * Call in app.config.ts to configure the connect-angular library.
 *
 * @example
 * // app.config.ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideConnectAngular({
 *       tokenEndpointUrl: 'http://localhost:3333/api/pipedream/token',
 *       externalUserId: 'user-123',
 *     }),
 *     provideCustomTriggers([...]),
 *   ]
 * };
 */
export function provideConnectAngular(
  config: PipedreamConnectConfig
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PIPEDREAM_CONFIG, useValue: config },
  ]);
}
```

---

## Step 5 — Update `index.ts`

Replace `poc/libs/connect-angular/src/index.ts` with:

```typescript
// Tokens
export { PIPEDREAM_CONFIG, PipedreamConnectConfig } from './lib/tokens/pipedream-config.token';
export { CUSTOM_TRIGGERS, provideCustomTriggers } from './lib/tokens/custom-triggers.token';

// Models
export { CustomTrigger, JsonSchema, JsonSchemaProperty } from './lib/models/custom-trigger.model';

// Services
export { PipedreamClientService } from './lib/services/pipedream-client.service';

// Provider
export { provideConnectAngular } from './lib/provide-connect-angular';
```

(Remove the existing stub `ConnectAngular` component export — it is no longer needed.)

---

## Step 6 — Verify

```bash
# From poc/
npx nx build connect-angular
# Should compile with no errors
```

If there are type errors from `@pipedream/sdk/browser`, check the SDK's exports:
```bash
cat poc/node_modules/@pipedream/sdk/package.json | grep -A 20 '"exports"'
```
And adjust the import path accordingly.

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/libs/connect-angular/src/lib/models/custom-trigger.model.ts` | Create |
| `poc/libs/connect-angular/src/lib/tokens/pipedream-config.token.ts` | Create |
| `poc/libs/connect-angular/src/lib/tokens/custom-triggers.token.ts` | Create |
| `poc/libs/connect-angular/src/lib/services/pipedream-client.service.ts` | Create |
| `poc/libs/connect-angular/src/lib/provide-connect-angular.ts` | Create |
| `poc/libs/connect-angular/src/index.ts` | Replace |

## Notes

- `PipedreamClientService` is `providedIn: 'root'` — one instance per app
- The `tokenCallback` is deliberately deferred with `setTimeout(..., 0)` to avoid running inside Angular's change detection cycle — this matches the pattern used in `connect-react-demo/src/actions/tokenActions.ts`
- `externalUserId` is passed at configuration time; if your app switches users, recreate the service (restart the app or provide it at a non-root scope)
