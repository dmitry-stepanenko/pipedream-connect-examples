# connect-angular

Angular equivalent of [`@pipedream/connect-react`](https://github.com/PipedreamHQ/pipedream/tree/master/packages/connect-react). Provides the Angular primitives needed to embed Pipedream Connect into any Angular application — app/component selection, dynamic prop forms, and OAuth account connection.

## Scope

This library is a **thin SDK wrapper**. It should contain only:

- **SDK initialization** — `PipedreamClientService` wraps `createFrontendClient` and handles token acquisition
- **Read/query operations** — listing apps, components, and connected accounts
- **UI-initiating actions** — `connectAccount` (opens the Pipedream OAuth popup)
- **Prop utilities** — `reloadProps`, `configureProp`, `runAction`
- **Reusable form components** — `ComponentFormComponent`, `AppSelectorComponent`, `ComponentSelectorComponent`, and their field primitives

### What does NOT belong here

- Application-specific write operations (e.g. deleting accounts, saving workflows). Those belong in the feature library that owns that domain and should call your own backend API.
- Business logic tied to a particular workflow or use case.
- Any component that is only useful in one specific feature.

If you find yourself reaching for `apiBaseUrl` to call a custom backend endpoint from inside this library, the logic belongs elsewhere.

## Key exports

| Export | Purpose |
|---|---|
| `PipedreamClientService` | Angular service wrapping the Pipedream browser SDK |
| `ComponentFormComponent` | Renders a dynamic prop form for any Pipedream component |
| `AppSelectorComponent` | App search + selection UI |
| `ComponentSelectorComponent` | Component (trigger/action) search + selection UI |
| `PIPEDREAM_CONFIG` | Injection token for library configuration |
| `provideConnectAngular()` | Registers the library providers in `app.config.ts` |
| `CUSTOM_TRIGGERS` / `provideCustomTriggers()` | Register custom (non-Pipedream) trigger definitions |

## Setup

```ts
// app.config.ts
import { provideConnectAngular } from '@poc/connect-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideConnectAngular({
      tokenEndpointUrl: '/api/pipedream/token',
      apiBaseUrl: 'http://localhost:3333',
      externalUserId: 'user-123', // from your own auth layer
    }),
  ],
};
```

## Running unit tests

Run `nx test connect-angular` to execute the unit tests.
