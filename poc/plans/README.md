# Workflow Builder — Implementation Plans

A custom workflow automation service built on top of `@pipedream/sdk`, with an Angular UI library (`@poc/connect-angular`) as the Angular equivalent of `@pipedream/connect-react`.

## Project Layout

```
pipedream-connect-examples/
├── connect-react-demo/          ← React reference implementation (read-only reference)
└── poc/                         ← NX monorepo (Angular 21.2, NX 22.6, TypeScript 5.9)
    ├── apps/
    │   ├── api/                 ← Express token server (Node/CommonJS)
    │   └── myapp/               ← Angular demo app (standalone components)
    ├── libs/
    │   └── connect-angular/     ← Angular UI library (path alias: @poc/connect-angular)
    └── plans/                   ← This folder
```

## Architecture Summary

- **Data layer**: `@pipedream/sdk` — framework-agnostic, used directly in both API and Angular app
- **UI library**: `@poc/connect-angular` — Angular equivalent of `@pipedream/connect-react`
- **Auth**: short-lived tokens minted server-side by `api`, consumed by Angular via `PipedreamClientService`
- **Workflow state**: Angular signals + localStorage (no backend persistence for demo)
- **Custom triggers**: provided via Angular DI injection token (`CUSTOM_TRIGGERS`), keeping the library generic

## After Implementing a Plan

1. **Write a summary** — create `PLAN-XX-summary.md` next to the plan file. Include: status, files created/modified, corrections made vs. the plan, design decisions, and any open issues. Then add a `[summary](PLAN-XX-summary.md)` link in the Notes column of the Execution Order table below.
2. **Update NEXT-STEPS.md** — add any manual actions that remain — credentials to fill in, external systems to configure, verification steps, etc. This keeps the implementor from hunting through plan files to figure out what still needs a human touch.

## Execution Order

| Plan | Description | Depends on | Notes |
|------|-------------|------------|-------|
| [PLAN-01](PLAN-01-api-token-endpoint.md) | Add Pipedream token endpoint to Express API | — | |
| [PLAN-02](PLAN-02-connect-angular-core.md) | Core library: services, DI tokens, provider | PLAN-01 (for context) | [summary](PLAN-02-summary.md) |
| [PLAN-03](PLAN-03-selectors.md) | AppSelector and ComponentSelector components | PLAN-02 | [summary](PLAN-03-summary.md) |
| [PLAN-04](PLAN-04-component-form.md) | Dynamic ComponentForm (all prop types) | PLAN-02, PLAN-03 | [summary](PLAN-04-summary.md) |
| [PLAN-05](PLAN-05-workflow-service.md) | Workflow data model + WorkflowService | PLAN-02 | |
| [PLAN-06](PLAN-06-workflow-builder-ui.md) | Workflow Builder UI (visual graph) | PLAN-03, PLAN-04, PLAN-05 | |
| [PLAN-07](PLAN-07-myapp-integration.md) | Wire everything into myapp demo | PLAN-01–06 | |
| [PLAN-08](PLAN-08-ai-chat-mcp.md) | Phase 2: AI chat via Pipedream MCP | PLAN-07 | |

## Instructions for AI Agents

- **Always write a summary after completing a plan.** Create `PLAN-XX-summary.md` next to the plan file and add a `[summary](PLAN-XX-summary.md)` link in the Notes column of the Execution Order table above. See existing summaries (PLAN-02, PLAN-03, PLAN-04) for the expected format: status, files created/modified, corrections vs. plan, design decisions, and component API.
- **Update NEXT-STEPS.md** with any manual actions that remain after implementation.
- **Read prior summaries** before starting a new plan — they contain corrections and decisions that later plans depend on.

## Key Conventions

- **Angular version**: 21.2 — use standalone components, `inject()`, signals (`signal`, `computed`, `effect`, `resource`)
- **No NgModules** — everything is standalone
- **Signals over RxJS** — prefer signals for local state; RxJS only for HTTP streams where natural
- **Component selectors**: prefix `pd-` (e.g. `pd-app-selector`, `pd-component-form`)
- **NX generators only** — never create app/lib files by hand; use `nx generate` for new apps and libs
- **`@pipedream/sdk` not yet installed** in `poc/package.json` — PLAN-01 adds it

## Reference Files

- `connect-react-demo/src/` — full working React implementation to use as a logic reference
- `connect-react-demo/package.json` — shows `@pipedream/connect-react@^2.7.3` and `@pipedream/sdk@^2.3.7`
- `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/` — **full connect-react source** (readable, use this as the primary reference for all library plans)
  - `components/` — `SelectApp.tsx`, `SelectComponent.tsx`, `ComponentForm.tsx`, `InternalComponentForm.tsx`, `Field.tsx`, `InternalField.tsx`, `Control*.tsx`
  - `hooks/` — `frontend-client-context.tsx`, `form-context.tsx`, `use-apps.tsx`, `use-components.tsx`, `use-component.tsx`, `use-accounts.tsx`
  - `types.ts`, `theme.ts` — shared types and theming
- `connect-react-demo/src/` — demo app showing how the library is consumed
- `poc/libs/connect-angular/src/index.ts` — library entry point (currently a stub)
- `poc/apps/api/src/main.ts` — Express server entry point (currently minimal)

## Environment Variables

The API needs a `.env` file (see PLAN-01). The Angular app reads `environment.ts` files (see PLAN-07).

```
# poc/apps/api/.env
PIPEDREAM_CLIENT_ID=...
PIPEDREAM_CLIENT_SECRET=...
PIPEDREAM_PROJECT_ID=...
PIPEDREAM_PROJECT_ENVIRONMENT=development   # or production
PORT=3333
ALLOWED_ORIGIN=http://localhost:4200
```
