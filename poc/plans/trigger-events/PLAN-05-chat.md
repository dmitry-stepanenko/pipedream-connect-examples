# Phase 05 — Chat Component

## `TryTriggerComponent` rename → `CaptureEventComponent`

File: `libs/feature-workflow-builder/src/lib/components/chat-panel/components/capture-event.component.ts`

Changes:
- Selector: `pd-try-trigger` → `pd-capture-event`
- Label copy: "Click **Try Now**…" → "Click **Capture Event**…"
- Button label: "▶ Try Now" → "⏺ Capture Event"
- Call `workflowService.captureEvent(workflowId, 90_000)` instead of
  `workflowService.tryTrigger(workflowId)`
- Show countdown on the button while running (same countdown logic as the
  builder UI — `setInterval` inside `run()`)
- On success: send message `'I clicked "Capture Event" and the trigger sample was captured successfully.'`

## `chat-definition.ts` changes

- Replace `TryTriggerComponent` import/reference with `CaptureEventComponent`
- Update the `exposeComponent` registration name

## System prompt update (`<trigger_sample_event>` section)

Replace references to "Try Now" with "Capture Event". Example updated wording:

```xml
<trigger_sample_event>
  When the user has configured the trigger step but no sample event has been
  captured yet, render a <pd-capture-event> component to let the user capture
  one. This is required before you can configure steps that reference
  {{steps.trigger.event.*}} paths.

  After the user captures an event, you will receive a confirmation message.
  At that point the trigger snapshot is available and you can proceed to
  configure downstream steps.
</trigger_sample_event>
```

## No changes needed

- `chat-definition.ts` tools (`add_workflow_step`, `set_step_props`, etc.) are
  unaffected — they don't reference the trigger capture mechanism.
- The `<cascading_invalidation>` and `<workflow_editing>` system prompt sections
  are unaffected.
