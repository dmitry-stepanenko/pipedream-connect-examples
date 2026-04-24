# Phase 04 — Frontend UI

## Trigger step detail panel changes

### Remove
- "⚡ Generate Test Event" button block and all its signals
  (`emittingTestEvent`, `testEventError`, `testEventJson`)

### Rename "Try Now" → "Capture Event"

Button label: **"⏺ Capture Event"**  
While running: countdown shown on the button — **"Capturing… 58s"** — updated
every second until the backend responds or the timeout fires.

New signals needed in `WorkflowBuilderComponent`:
```typescript
protected readonly capturingEvent = signal(false);
protected readonly captureCountdown = signal<number | null>(null);
protected readonly captureError = signal<string | null>(null);
// Remove: tryingTrigger, tryTriggerError, tryTriggerJson
```

Countdown implementation:
```typescript
protected async captureEvent() {
  const timeoutMs = 90_000; // 90 s, configurable
  this.capturingEvent.set(true);
  this.captureCountdown.set(timeoutMs / 1000);
  this.captureError.set(null);

  const timer = setInterval(() => {
    this.captureCountdown.update((v) => (v !== null && v > 0 ? v - 1 : 0));
  }, 1000);

  try {
    const result = await this.workflowService.captureEvent(w.id, timeoutMs);
    if (!result.success) {
      this.captureError.set(result.error);
    } else {
      // Reload event list to include the new event.
      await this.workflowService.loadTriggerEvents(w.id);
    }
  } finally {
    clearInterval(timer);
    this.capturingEvent.set(false);
    this.captureCountdown.set(null);
  }
}
```

Button template:
```html
<button (click)="captureEvent()" [disabled]="capturingEvent()">
  @if (capturingEvent()) {
    Capturing… {{ captureCountdown() }}s
  } @else {
    ⏺ Capture Event
  }
</button>
```

### Event list in trigger step detail

Show below the Capture button. Load on open, refresh after capture.

```html
@if (workflowService.triggerEvents().length) {
  <div class="pd-event-list">
    @for (ev of workflowService.triggerEvents(); track ev.id) {
      <div class="pd-event-item" [class.pd-event-item--stale]="ev.isStale">
        <span class="pd-event-item__time">
          {{ ev.capturedAt | date:'short' }}
        </span>
        @if (ev.isStale) {
          <span class="pd-event-item__stale-badge">stale</span>
        }
        <button class="pd-btn-link" (click)="useEvent(ev)">Use</button>
      </div>
    }
  </div>
}
```

"Use" sets that event as the active trigger snapshot (calls a new
`WorkflowService.setActiveTriggerEvent(ev)` which writes the snapshot to the
local trigger step — no API call needed).

## Header — "Test Run" button

### Current behaviour
Only shown when `isPublished()`. Calls `triggerWorkflow()` directly.

### New behaviour
Shown whenever `workflowService.triggerEvents().length > 0` (at least one event
captured, regardless of publish state).

Clicking opens the **Event Picker Dialog** instead of running immediately.

```html
@if (workflowService.triggerEvents().length > 0) {
  <button (click)="openTestRunDialog()" [disabled]="triggering()">
    @if (triggering()) { Running... } @else { ▶ Test Run }
  </button>
}
```

## Event Picker Dialog

New standalone component: `EventPickerDialogComponent`.

```
┌──────────────────────────────────────────────┐
│  Select an event to run the workflow with     │
│                                              │
│  ○  Apr 24 2026, 14:32:01                   │
│  ○  Apr 24 2026, 13:15:44  ⚠ stale          │
│  ○  Apr 23 2026, 09:00:12  ⚠ stale          │
│                                              │
│  [ Cancel ]             [ Run Workflow → ]   │
└──────────────────────────────────────────────┘
```

- Stale events shown with a warning icon and muted style
- "Run Workflow →" disabled until an event is selected
- On confirm: calls `workflowService.testRun(workflowId, selectedEventId)`
  then closes dialog and shows results (same `triggerResults` signal as today)

## Signals to remove from WorkflowBuilderComponent

| Signal | Reason |
|---|---|
| `tryingTrigger` | Replaced by `capturingEvent` |
| `tryTriggerError` | Replaced by `captureError` |
| `tryTriggerJson` | No longer shown inline |
| `emittingTestEvent` | Button removed |
| `testEventError` | Button removed |
| `testEventJson` | Button removed |

## Signals to add

| Signal | Purpose |
|---|---|
| `capturingEvent` | Disable button, show countdown |
| `captureCountdown` | Seconds remaining |
| `captureError` | Error below button |
| `testRunDialogOpen` | Controls dialog visibility |
| `selectedEventId` | Currently highlighted event in dialog |
