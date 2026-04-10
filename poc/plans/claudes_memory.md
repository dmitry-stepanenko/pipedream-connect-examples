---
name: Workflow Builder Project
description: Custom Pipedream-based workflow automation service built in the poc NX monorepo
type: project
---

Building a custom workflow automation UI (like Pipedream) in the `poc/` NX monorepo at `/Users/dmitry/projects/temp/pipedream-connect-examples/poc/`.

**Why:** Provide customers a branded workflow builder that uses Pipedream infrastructure under the hood, with support for internal custom triggers (e.g. "Order Created").

**How to apply:** When working in the poc/ directory, this is the primary feature being built.

## Key paths
- `poc/plans/` — 8 implementation plan files (PLAN-01 through PLAN-08 + README)
- `poc/libs/connect-angular/` — Angular library (`@poc/connect-angular`), Angular equivalent of `@pipedream/connect-react`
- `poc/apps/myapp/` — Angular demo app consuming the library
- `poc/apps/api/` — Express token server (simple, one endpoint)
- `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/` — actual connect-react source to reference during implementation

## Architecture
- Data layer: `@pipedream/sdk` (not yet installed in poc/ — PLAN-01 adds it)
- UI library: `@poc/connect-angular` using Angular 21 signals + standalone components
- Auth: short-lived tokens minted by api, consumed by Angular via PipedreamClientService
- Workflow state: signals + localStorage (no backend persistence for demo)
- Custom triggers: provided via Angular DI injection token `CUSTOM_TRIGGERS`

## Implementation order
PLAN-01 (API token endpoint) → PLAN-02 (core services) → PLAN-03 (selectors) → PLAN-04 (ComponentForm) → PLAN-05 (WorkflowService) → PLAN-06 (Workflow Builder UI) → PLAN-07 (myapp integration) → PLAN-08 (AI chat/MCP, phase 2)

## Key decisions
- Angular signals everywhere (no RxJS for local state)
- `pd-` prefix for component selectors
- NX generators only for new apps/libs (never create manually)
- `@angular/cdk` drag-drop for step reordering
- PLAN-04 has one open question: verify exact SDK method for dynamic props reload from installed types before implementing `configureProps()`
