# Workflow Persistence & Execution — Implementation Plan

## Context

Workflows currently live in `localStorage`. The goal is to store them server-side (CF Worker + KV), deploy Pipedream triggers on publish, and execute action chains when triggers fire. This enables real workflow automation instead of just UI prototyping.

---

## Data Model Changes

**File: `libs/connect-angular/src/lib/models/workflow.model.ts`** (shared model, also duplicated in API)

Add to `Workflow`:
```typescript
type WorkflowStatus = 'draft' | 'published' | 'error';

interface Workflow {
  // ...existing fields...
  status: WorkflowStatus;
  externalUserId: string;
  deployedTriggerId?: string;   // dc_xxx from Pipedream, set on publish
  customTriggerId?: string;     // from step[0].customTriggerId, indexed for lookup
  lastError?: string;
}
```

---

## Backend — API Endpoints

All under `/api/workflows`. Every request includes `externalUserId` (query param or body).

### CRUD
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/workflows?externalUserId=xxx` | List user's workflows |
| `POST` | `/api/workflows` | Create workflow (status: draft) |
| `GET` | `/api/workflows/:id?externalUserId=xxx` | Get single workflow |
| `PUT` | `/api/workflows/:id` | Save full workflow |
| `DELETE` | `/api/workflows/:id?externalUserId=xxx` | Delete (unpublishes first if needed) |

### Lifecycle
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflows/:id/publish` | Deploy trigger + mark published |
| `POST` | `/api/workflows/:id/unpublish` | Delete trigger + mark draft |

### Webhooks (called by Pipedream / host app, not browser)
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/webhooks/pipedream/:workflowId` | Receives PD trigger events, runs action chain |
| `POST` | `/api/webhooks/custom/:customTriggerId` | Receives custom business events, runs matching workflows |

---

## Storage — Cloudflare KV

Namespace binding: `WORKFLOWS` in `wrangler.jsonc`.

| Key Pattern | Value | Purpose |
|---|---|---|
| `wf:{workflowId}` | `Workflow` JSON | Primary storage |
| `user:{externalUserId}` | `string[]` (workflow IDs) | User index for listing |
| `ct:{customTriggerId}:{externalUserId}` | `string[]` (workflow IDs) | Custom trigger reverse lookup |

No reverse lookup needed for Pipedream triggers — the webhook URL contains the `workflowId` directly: `{WORKER_BASE_URL}/api/webhooks/pipedream/{workflowId}`.

---

## Publish Flow

### Pipedream app trigger
```
Frontend → POST /api/workflows/:id/publish
  → pd.triggers.deploy({
      id: componentKey,
      externalUserId,
      configuredProps: normalizeAppProps(step.configuredProps, step.component.configurableProps),
      webhookUrl: `${WORKER_BASE_URL}/api/webhooks/pipedream/${workflowId}`,
      emitOnDeploy: false,
    })
  → store deployedTriggerId on workflow
  → set status = 'published'
```

### Custom trigger
```
Frontend → POST /api/workflows/:id/publish
  → add workflowId to KV index at ct:{customTriggerId}:{externalUserId}
  → set status = 'published', customTriggerId on workflow
```

### Unpublish
```
Frontend → POST /api/workflows/:id/unpublish
  → if deployedTriggerId: pd.deployedTriggers.delete(deployedTriggerId, { externalUserId, ignoreHookErrors: true })
  → if customTriggerId: remove from KV index
  → set status = 'draft', clear deployedTriggerId/customTriggerId
```

---

## Execution Flow

Execution uses `ctx.waitUntil()` — the webhook responds 202 immediately, then the action chain runs in the background (up to 5 min wall-clock on the paid Workers plan).

Each step receives the accumulated outputs of all previous steps via a `stepOutputs` map:

```typescript
// Built up as each step completes
const stepOutputs: Record<string, unknown> = {
  trigger: { event: triggerPayload },
};

for (const step of actionSteps) {
  const result = await pd.actions.run({
    id: step.data.component.key,
    externalUserId: workflow.externalUserId,
    configuredProps: normalizeAppProps(step.data.configuredProps, step.data.component.configurableProps),
    // TODO: resolve {{steps.X.Y}} references in configuredProps using stepOutputs
  });

  stepOutputs[step.id] = {
    ret: result.ret,
    exports: result.exports,
  };
}
```

### Pipedream trigger webhook (`POST /api/webhooks/pipedream/:workflowId`)

1. Read workflow from KV, verify `status === 'published'`
2. Respond 202 immediately
3. `ctx.waitUntil()` runs the chain:
   a. Initialize `stepOutputs = { trigger: { event: requestBody } }`
   b. For each action step (index 1..N):
      - Resolve `configuredProps` (future: substitute `{{steps.X.Y}}` references from `stepOutputs`)
      - `pd.actions.run(...)` with normalized props
      - Store result in `stepOutputs[step.id]`
      - On failure: stop chain, update `workflow.lastError` in KV

### Custom trigger (`POST /api/webhooks/custom/:customTriggerId`)

1. Read `x-external-user-id` header
2. Look up workflow IDs from KV `ct:{customTriggerId}:{externalUserId}`
3. Respond 202 immediately
4. `ctx.waitUntil()` executes each matching workflow's action chain (same flow as above, with the custom event payload as `trigger.event`)

---

## Backend File Changes

### Modify
- **`apps/api/src/env-vars.ts`** — add `WORKFLOWS: KVNamespace`, `WORKER_BASE_URL?: string`
- **`apps/api/src/index.ts`** — mount new route groups
- **`apps/api/src/utils/util-cors.ts`** — add `PATCH`, `PUT` to allowed methods; add `x-external-user-id` to allowed headers
- **`apps/api/wrangler.jsonc`** — add `kv_namespaces` for `WORKFLOWS`

### Create
- **`apps/api/src/models/workflow.model.ts`** — server-side workflow types (mirrors Angular model + new fields + API request/response types)
- **`apps/api/src/services/workflow-store.ts`** — KV read/write layer (`listWorkflows`, `getWorkflow`, `saveWorkflow`, `deleteWorkflow`, custom trigger index ops)
- **`apps/api/src/services/workflow-engine.ts`** — `publishWorkflow`, `unpublishWorkflow`, `executeWorkflow`
- **`apps/api/src/utils/normalize-props.ts`** — port of `PipedreamClientService.normalizeAppProps()` for server-side use
- **`apps/api/src/routes/workflows.ts`** — Hono route group for CRUD + lifecycle
- **`apps/api/src/routes/webhooks.ts`** — Hono route group for PD + custom trigger webhooks

---

## Frontend File Changes

### Modify
- **`libs/connect-angular/src/lib/models/workflow.model.ts`** — add `status`, `externalUserId`, `deployedTriggerId`, `customTriggerId`, `lastError`
- **`libs/connect-angular/src/lib/tokens/pipedream-config.token.ts`** — add `apiBaseUrl: string` to `PipedreamConnectConfig`
- **`libs/connect-angular/src/lib/services/workflow.service.ts`** — replace localStorage with API calls via `WorkflowApiService`; add `publishWorkflow()`, `unpublishWorkflow()`, `loadWorkflows()`; keep `testStep()` as-is (runs via frontend SDK)
- **`libs/connect-angular/src/lib/components/workflow-builder/workflow-builder.ts`** — add publish/unpublish actions, status display, `canPublish` computed
- **`libs/connect-angular/src/lib/components/workflow-builder/workflow-builder.html`** — publish button + status badge
- **`libs/connect-angular/src/lib/components/workflow-list/workflow-list.ts`** — call `loadWorkflows()` on init, show status
- **`apps/myapp/src/app/app.config.ts`** — pass `apiBaseUrl` in `provideConnectAngular()`

### Create
- **`libs/connect-angular/src/lib/services/workflow-api.service.ts`** — HTTP client for the new backend endpoints (all CRUD + publish/unpublish)

---

## Pipedream SDK Usage

### Deploy trigger
```typescript
// pd = new PipedreamClient({ projectId, clientId, clientSecret, ... })
const response = await pd.triggers.deploy({
  id: componentKey,           // e.g. 'github-new-issue'
  externalUserId,
  configuredProps,            // normalized with authProvisionId wrappers
  webhookUrl,                 // our webhook endpoint URL
  emitOnDeploy: false,
});
// response.data.id = 'dc_xxx' (the deployed trigger ID)
// response.data.webhookSigningKey = signing key for verifying payloads
```

### Delete trigger
```typescript
await pd.deployedTriggers.delete(deployedTriggerId, {
  externalUserId,
  ignoreHookErrors: true,
});
```

### Run action
```typescript
const result = await pd.actions.run({
  id: componentKey,           // e.g. 'slack-send-message'
  externalUserId,
  configuredProps,            // normalized
});
// result.ret = return value, result.exports = named outputs
```

---

## Implementation Phases

### Phase 1: Backend CRUD + KV
1. Add KV namespace to `wrangler.jsonc`
2. Create server-side workflow model types
3. Create `workflow-store.ts` KV access layer
4. Create `routes/workflows.ts` with CRUD endpoints
5. Mount in `index.ts`, update CORS

### Phase 2: Frontend Migration
1. Update `workflow.model.ts` with new fields
2. Add `apiBaseUrl` to `PipedreamConnectConfig`
3. Create `WorkflowApiService` HTTP client
4. Refactor `WorkflowService` to use API calls
5. Update `WorkflowListComponent` to load from server

### Phase 3: Publish/Unpublish
1. Create `normalize-props.ts` on backend
2. Create `workflow-engine.ts` (publish/unpublish logic)
3. Add lifecycle endpoints to routes
4. Add publish/unpublish to frontend service + UI

### Phase 4: Execution
1. Add `executeWorkflow()` to engine
2. Create `routes/webhooks.ts` (PD webhook + custom trigger handlers)
3. End-to-end test: create -> publish -> trigger fires -> actions execute

---

## Open Decisions

1. **Error handling in action chains** — POC: stop on first failure. Production: could retry or skip.
2. **Webhook signature verification** — `webhookSigningKey` is returned on deploy. POC: skip verification. Production: verify `x-pd-signature` header.
3. **KV eventual consistency** — acceptable for POC. Production would use Durable Objects for strong consistency.
4. **Worker base URL for webhooks** — set via `WORKER_BASE_URL` env var. During local dev, requires tunneling (e.g. `cloudflared tunnel`) for Pipedream to reach the worker.

---

## Sources

- [Deploying Triggers](https://pipedream.com/docs/connect/components/triggers)
- [Deploy Trigger API](https://pipedream.com/docs/connect/api-reference/deploy-trigger)
- [Executing Actions](https://pipedream.com/docs/connect/components/actions)
- [Run Action API](https://pipedream.com/docs/connect/api-reference/run-action)
- [Webhook Configuration](https://pipedream.com/docs/connect/api-reference/update-trigger-webhooks)
