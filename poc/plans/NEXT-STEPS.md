# Next Steps — Manual Actions Required

This file tracks manual steps that cannot be automated by an AI agent (credentials, external config, verification). Update it after each plan is implemented.

---

## After PLAN-01 — API Token Endpoint

**Status:** Implemented, pending credential setup.

### Required before running the API

1. **Fill in Pipedream credentials** in `poc/apps/api/.env`:
   - `PIPEDREAM_CLIENT_ID` — from pipedream.com → Settings → Projects → your project → OAuth clients
   - `PIPEDREAM_CLIENT_SECRET` — same location
   - `PIPEDREAM_PROJECT_ID` — your project ID

2. **Verify the endpoint works:**
   ```bash
   # Terminal 1 — from poc/
   npx nx serve api

   # Terminal 2
   curl -X POST http://localhost:3333/api/pipedream/token \
     -H "Content-Type: application/json" \
     -d '{"externalUserId": "test-user-1"}'
   # Expected: { token: "...", expires_at: "..." }
   ```

---

## After PLAN-02 — connect-angular Core Services

**Status:** Implemented. Types compile clean.

### No manual action required

All files are generated code with no external configuration dependencies. The library is ready for PLAN-03 to build on top of.

### Known stub

`PipedreamClientService.configureProps()` throws a `not implemented` error. It is intentionally left as a stub — the correct SDK call will be determined when implementing PLAN-04 (ComponentForm), which is the first consumer of dynamic props.

---

## After PLAN-05 — Workflow Data Model & WorkflowService

**Status:** Implemented. Build passes.

### No manual action required

`WorkflowService` is `providedIn: 'root'` and self-contained. No external configuration or credentials needed.

### Ready for

PLAN-06 (Workflow Builder UI) can now consume `WorkflowService` and the workflow model types directly from `@poc/connect-angular`.

---

## After PLAN-06 — Workflow Builder UI

**Status:** Implemented. Build passes.

### No manual action required

All four components (`pd-workflow-list`, `pd-workflow-builder`, `pd-workflow-step`, `pd-step-picker`) are library-only with no external dependencies beyond what's already configured (Pipedream SDK + API token endpoint from PLAN-01).

`@angular/cdk@21.2.6` was installed for drag-drop reordering.

### Ready for

PLAN-07 (myapp integration) can now import all workflow UI components from `@poc/connect-angular` and wire them into the demo app.

## After PLAN-07 — myapp Integration

**Status:** Implemented. Build passes.

### Required before running the demo

1. **Ensure Pipedream credentials are configured** in `poc/apps/api/.env` (see PLAN-01 section above).

2. **Run both servers:**
   ```bash
   # Terminal 1 — API
   cd poc && npx nx serve api

   # Terminal 2 — Angular app
   cd poc && npx nx serve myapp
   ```

3. **Open `http://localhost:4200`** — you should see the workflow builder with sidebar and canvas.

### Cleanup (optional)

The NX scaffold files `apps/myapp/src/app/app.html`, `apps/myapp/src/app/app.scss`, `apps/myapp/src/app/nx-welcome.ts`, and `apps/myapp/src/app/app.routes.ts` are no longer referenced by the app. They can be safely deleted.

### Ready for

PLAN-08 (AI Chat via Pipedream MCP) can build on top of the working demo app.

<!-- Add a new section here after each subsequent plan is implemented -->
