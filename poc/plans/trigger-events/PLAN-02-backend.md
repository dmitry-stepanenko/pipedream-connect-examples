# Phase 02 — Backend Routes & Engine

## Routes to remove

| Route | Reason |
|---|---|
| `POST /:id/emit-test-event` | Replaced by capture-event |
| `POST /:id/trigger-snapshot` | No longer needed |
| `GET /:id/trigger-events` | Replaced with DB-backed version |

## Engine functions to remove

- `getTestTriggerEvent()` in `workflow-engine.ts` — no remaining callers after
  this phase.

## `POST /:id/trigger` update

This is the "Test Run" route. Currently it calls `getTestTriggerEvent` and is
publish-gated. Change it to:

- Accept `{ externalUserId, eventId }` in the body
- Look up the event from `trigger_events` by `eventId` (must belong to this
  workflow)
- Remove publish guard — works for draft and published workflows
- `executeWorkflow(pd, db, workflow, event, 'test')`

```typescript
workflows.post('/:id/trigger', async (c) => {
  const { externalUserId, eventId } = await c.req.json();
  // ... auth/ownership check ...

  const triggerEvent = await getTriggerEvent(db, eventId, workflowId);
  if (!triggerEvent) {
    return c.json({ error: 'Event not found' }, 404);
  }

  const run = await executeWorkflow(pd, db, workflow, triggerEvent.event, 'test');
  return c.json({ run });
});
```

## `POST /:id/try-trigger` → `POST /:id/capture-event`

Rename the route. Accept `timeoutMs` from the body (frontend sends the
user-facing countdown duration, default 60 000 ms).

Changes to `tryTrigger()` in `workflow-engine.ts`:
1. Remove the `workflow.deployedTriggerId` shortcut branch — always use
   temp-deploy + `emitOnDeploy:true` + poll.
2. Accept `timeoutMs` parameter, pass it to the poll loop.
3. Return `{ event }` instead of `{ snapshot }` — snapshot writing moves to
   the route handler.

Route handler changes:
1. Call updated `captureEvent(pd, db, env, workflow, externalUserId, timeoutMs)`.
2. Call `appendTriggerEvent(db, workflowId, triggerKey, event)` to persist.
3. Also write `event` to the trigger step's `outputSnapshot` (keeps the
   existing step-by-step testing path working).
4. Return `{ event: TriggerEvent }` (the full stored record, not just the raw payload).

```typescript
workflows.post('/:id/capture-event', async (c) => {
  const { externalUserId, timeoutMs = 60_000 } = await c.req.json();
  // ... auth/ownership check ...

  const pdStep = workflow.steps[0]?.data as PipedreamStep;
  const triggerKey = pdStep.component.key;

  const { event } = await captureEvent(pd, db, env, workflow, externalUserId, timeoutMs);

  const stored = await appendTriggerEvent(db, workflow.id, triggerKey, event);

  // Keep trigger step snapshot up to date for step testing.
  const trigger = workflow.steps[0];
  trigger.outputSnapshot = { $return_value: event, exports: {} };
  await saveWorkflow(db, workflow);

  return c.json({ event: stored });
});
```

## `GET /:id/trigger-events` (replaced)

New version reads from the `trigger_events` table instead of the Pipedream API:

```typescript
workflows.get('/:id/trigger-events', async (c) => {
  // ... auth/ownership check ...
  const events = await listTriggerEvents(db, workflowId);
  return c.json({ events });
});
```

## Rename in engine: `tryTrigger` → `captureEvent`

Signature change:

```typescript
export async function captureEvent(
  pd: PipedreamClient,
  db: Db,
  env: ENV_VARS,
  workflow: Workflow,
  externalUserId: string,
  timeoutMs: number = 60_000,
): Promise<{ event: Record<string, unknown> }>
```

Remove the `workflow.deployedTriggerId` branch. The unified path for all
non-schedule app triggers:

1. Temp-deploy with `emitOnDeploy: true` and a throwaway webhook URL
2. Poll Pipedream for the emitted event up to `timeoutMs`
3. Delete the temp deployment
4. Return `{ event }`

Schedule triggers still return a synthetic event immediately (no deploy needed).
Custom triggers return a placeholder.
