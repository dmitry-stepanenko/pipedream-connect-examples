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

<!-- Add a new section here after each subsequent plan is implemented -->
