# Phase 03 — Frontend Services

## `WorkflowApiService` changes

### Remove
- `emitTestEvent(id)` → `POST /:id/emit-test-event`
- `tryTrigger(id)` → `POST /:id/try-trigger`

### Rename / update
- `tryTrigger` → `captureEvent(id, timeoutMs: number)`
  - `POST /api/workflows/:id/capture-event`
  - Body: `{ externalUserId, timeoutMs }`
  - Returns: `{ event: TriggerEvent }`

- `triggerWorkflow(id)` → `testRun(id, eventId: string)`
  - `POST /api/workflows/:id/trigger`
  - Body: `{ externalUserId, eventId }`
  - Returns: `{ run }`

### Add
- `listTriggerEvents(id)` → `GET /api/workflows/:id/trigger-events`
  - Returns: `{ events: TriggerEvent[] }`

## `WorkflowService` changes

### Remove
- `emitTestEvent(id)`
- `tryTrigger(workflowId)` (old version)

### Add / update

```typescript
/** Capture a new event from the trigger and append it to the event list. */
async captureEvent(
  workflowId: string,
  timeoutMs: number,
): Promise<{ success: boolean; event: TriggerEvent | null; error: string | null }> {
  try {
    const result = await this.api.captureEvent(workflowId, timeoutMs);
    // Update the local workflow's trigger step snapshot so step-test works
    // immediately after capture without a reload.
    this._patchTriggerSnapshot(workflowId, result.event.event);
    return { success: true, event: result.event, error: null };
  } catch (err) {
    return { success: false, event: null, error: errorMessage(err) };
  }
}

/** List all captured events for this workflow (cached, refreshed after capture). */
readonly triggerEvents = signal<TriggerEvent[]>([]);

async loadTriggerEvents(workflowId: string): Promise<void> {
  const { events } = await this.api.listTriggerEvents(workflowId);
  this.triggerEvents.set(events);
}

/** Run all action steps using a previously captured event. */
async testRun(
  workflowId: string,
  eventId: string,
): Promise<{ run: unknown }> {
  return this.api.testRun(workflowId, eventId);
}
```

## New type: `TriggerEvent`

Add to `libs/data-access-api/src/lib/types/` (or the existing workflow type file):

```typescript
export interface TriggerEvent {
  id: string;
  workflowId: string;
  triggerKey: string;
  event: Record<string, unknown>;
  capturedAt: string;   // ISO 8601
  isStale: boolean;
}
```

## Notes

- `triggerEvents` signal is loaded when the workflow builder opens and after
  each successful capture.
- The signal lives on `WorkflowService` (not the component) so the chat panel
  and the builder header can both read it without prop-drilling.
