# Phase 06 — Rewrite the Deployed Triggers Page as Published Workflows

## Current problem

The page currently calls `GET /deployed-triggers` which hits the Pipedream API
(`pd.deployedTriggers.list`), joins with our DB only to attach a workflow name,
and shows Pipedream-side fields like `emitterType`, `createdAt` (Unix epoch).
This means:

- Dead deployed triggers (workflow republished → new `dc_xxx`) still show up
- Workflows with no `deployedTriggerId` match are shown as orphans
- We can't show all published workflows, only those Pipedream knows about
- The page is fragile to Pipedream API outages

## New approach

Read **everything from our own DB**. Filter `status = 'published'`. All the
data we need is already there:

| Field | Source |
|---|---|
| Workflow name | `workflows.name` |
| Trigger component name / app | `steps[0].data.component.name` / `.app.name` |
| Deployed trigger ID | `workflows.deployedTriggerId` |
| Published since | `workflows.updatedAt` |
| Execution runs | `execution_runs` table (already working) |
| Trigger event per run | `execution_runs.triggerEvent` (already working) |
| Step results | `execution_step_results` table (already working) |

## Backend changes

### Repurpose `GET /deployed-triggers`

Remove the Pipedream API fetch entirely. New implementation:

```typescript
workflows.get('/deployed-triggers', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) return c.json({ error: 'externalUserId required' }, 400);

  const db = createDb(c.env.DB);
  const all = await listWorkflows(db, externalUserId);
  const published = all.filter((w) => w.status === 'published');
  return c.json({ workflows: published });
});
```

No other backend changes needed — runs are already queried via `GET /:id/runs`.

### Remove `GET /deployed-triggers/:triggerId/events`

This route reads from `pd.deployedTriggers.listEvents` and is only useful when
looking up events by Pipedream trigger ID. After this change:

- The deployed triggers page no longer needs this (runs show trigger events from
  our DB via `execution_runs.triggerEvent`)
- If needed for debugging, it can stay but is no longer in the happy path

## Frontend service changes

### `WorkflowApiService`

Replace `listDeployedTriggers()`:

```typescript
// Old: returns { triggers: unknown[] } from Pipedream API
// New: returns { workflows: Workflow[] } from our DB
async listPublishedWorkflows(): Promise<{ workflows: Workflow[] }> {
  return this.get(`/deployed-triggers`);
}
```

The route path stays the same (`/deployed-triggers`) to avoid a migration,
but the response shape changes to `{ workflows }`.

Remove: `listDeployedTriggerEvents(triggerId, n)` — no longer called.

### `WorkflowService`

```typescript
async listPublishedWorkflows(): Promise<{ workflows: Workflow[] }> {
  return this.api.listPublishedWorkflows();
}
```

Remove: `listDeployedTriggers()`, `listDeployedTriggerEvents()`.

## Frontend UI changes

### Rename concepts

| Old | New |
|---|---|
| "Deployed Triggers" page title | "Published Workflows" |
| `DeployedTrigger` interface | Use `Workflow` from `@poc/data-access-api` |
| `triggersResource` loads triggers | Loads published workflows |

### Card layout (stays structurally the same)

Old card showed: trigger type, Pipedream ID, deployed date, extra props.

New card shows:

```
┌─────────────────────────────────────────────────────────────┐
│  📧 Weekly Digest                              [Open] [Runs] │
│  Trigger: Gmail · New Email   dc_abc123                      │
│  Published: Apr 23 2026                                      │
└─────────────────────────────────────────────────────────────┘
```

- **Title**: `workflow.name`
- **Trigger**: `step[0].data.component.name` (e.g. "New Email") + app name
- **Deployed trigger ID**: `workflow.deployedTriggerId` (shown as a `<code>`)
- **Published** (approx): `workflow.updatedAt` formatted date

Helper to extract trigger info from the first step:

```typescript
protected triggerInfo(workflow: Workflow): { name: string; app: string } | null {
  const step = workflow.steps[0];
  if (!step?.data || step.data.source !== 'pipedream') return null;
  const d = step.data as PipedreamStep;
  return { name: d.component.name ?? d.component.key, app: d.app.name ?? d.app.nameSlug };
}
```

### Runs section (unchanged)

The expand/collapse runs logic, `runsMap`, `loadRuns`, `ensureRunsLoaded` stay
exactly as-is — they already use `workflowService.listRuns(workflowId)` from
our DB.

### `extraProps` removed

This was used to display arbitrary Pipedream API fields. Not needed with our
own typed `Workflow` model.

### `toggleExpanded` key change

Currently keyed on `trigger.id` (the Pipedream `dc_xxx`). Change to
`workflow.id` for consistency:

```typescript
protected toggleExpanded(workflow: Workflow) {
  const next = this.expandedWorkflowId() === workflow.id ? null : workflow.id;
  this.expandedWorkflowId.set(next);
  if (next) this.ensureRunsLoaded(workflow);
}
```

## Summary of deletions

| Item | Location |
|---|---|
| `pd.deployedTriggers.list()` call | `GET /deployed-triggers` route |
| `pd.deployedTriggers.listEvents()` call | `GET /deployed-triggers/:triggerId/events` route (whole route can be removed) |
| `getWorkflowsByDeployedTriggerIds()` | `workflow-store.ts` — no longer needed by this route |
| `listDeployedTriggers()` | `WorkflowApiService` + `WorkflowService` |
| `listDeployedTriggerEvents()` | `WorkflowApiService` + `WorkflowService` |
| `DeployedTrigger` interface | `deployed-triggers-page.ts` |
| `extraProps()` helper | `deployed-triggers-page.ts` |
| `COMMON_KEYS` set | `deployed-triggers-page.ts` |
