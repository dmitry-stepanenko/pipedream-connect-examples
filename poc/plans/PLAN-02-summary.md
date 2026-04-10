# PLAN-02 Implementation Summary — connect-angular: Core Services & DI Tokens

**Status:** Complete. Type-checks clean with no errors.

---

## Files Created

| File | Purpose |
|------|---------|
| `poc/libs/connect-angular/src/lib/models/custom-trigger.model.ts` | `CustomTrigger`, `JsonSchema`, `JsonSchemaProperty` interfaces |
| `poc/libs/connect-angular/src/lib/tokens/pipedream-config.token.ts` | `PIPEDREAM_CONFIG` injection token + `PipedreamConnectConfig` interface |
| `poc/libs/connect-angular/src/lib/tokens/custom-triggers.token.ts` | `CUSTOM_TRIGGERS` token + `provideCustomTriggers()` helper |
| `poc/libs/connect-angular/src/lib/services/pipedream-client.service.ts` | `PipedreamClientService` wrapping `@pipedream/sdk` |
| `poc/libs/connect-angular/src/lib/provide-connect-angular.ts` | `provideConnectAngular()` setup function |

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/index.ts` | Replaced stub component export with full public API |

---

## Corrections Made vs. Plan

The plan was written before the actual SDK types were available. The following were corrected after inspecting `poc/node_modules/@pipedream/sdk/`:

| Issue | Plan said | Actual SDK |
|-------|-----------|------------|
| Client type | `FrontendClient` (named import) | `PipedreamClient` (the class returned by `createFrontendClient`) |
| Components list field | `{ type: ... }` | `{ componentType: ... }` |
| Accounts list field | `{ external_user_id: ... }` | `{ externalUserId: ... }` (camelCase) |
| `tokenCallback` return type | `Promise<unknown>` | `Promise<CreateTokenResponse>` (from `@pipedream/sdk`) |
| `index.ts` re-exports | `export { SomeType }` | `export type { SomeType }` — required by `isolatedModules: true` |

---

## `configureProps` Status

The `configureProps` method in `PipedreamClientService` intentionally throws `Error('Implement after checking @pipedream/sdk types for dynamic props API')`. The correct SDK call needs to be determined when implementing PLAN-04 (ComponentForm), which is the first consumer of dynamic props.

---

## Usage Example

```typescript
// app.config.ts
import { provideConnectAngular, provideCustomTriggers } from '@poc/connect-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideConnectAngular({
      tokenEndpointUrl: 'http://localhost:3333/api/pipedream/token',
      externalUserId: 'user-123',
    }),
    provideCustomTriggers([
      {
        id: 'order.created',
        name: 'Order Created',
        description: 'Fires when a new order is placed',
        payloadSchema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            total: { type: 'number' },
          },
          required: ['orderId'],
        },
      },
    ]),
  ],
};
```

```typescript
// any component or service
import { PipedreamClientService } from '@poc/connect-angular';

@Injectable({ providedIn: 'root' })
export class MyService {
  private pd = inject(PipedreamClientService);

  async searchApps(query: string) {
    return this.pd.listApps(query);
  }
}
```
