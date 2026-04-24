# Trigger Events — Overview

## Goal

Replace the current single-snapshot "Try Now" model with a persistent event
history per workflow trigger. The user can capture multiple events over time,
browse them, and pick any one to use when running a test workflow execution.
Publish/unpublish becomes fully decoupled from testing.

## Problems with the current model

| Problem | Impact |
|---|---|
| One snapshot slot on the trigger step — each capture overwrites | Can't compare events or replay earlier ones |
| "Test Run" only available when published | Can't test a draft workflow end-to-end |
| "Generate Test Event" duplicates "Try Now" with worse behaviour | Confusing UX; extra backend surface |
| `GET /:id/trigger-events` reads from live Pipedream event store (requires deployed trigger) | Can't list events for draft workflows |
| Snapshot deleted when trigger component changes | Events are lost even when they could be useful |

## Desired behaviour

1. **Capture Event (renamed from "Try Now")** — always uses temp-deploy +
   `emitOnDeploy:true` + poll + cleanup. Works identically for draft and
   published workflows. Appends the captured event to a persistent list (max
   20 per workflow). Shows a countdown timer on the button while polling.

2. **Event list** — shown in the trigger step detail panel. Lists all captured
   events newest-first, labeled by timestamp. Events captured from a different
   trigger component are marked stale but kept. Selecting an event from the
   list sets it as the active trigger snapshot for step-by-step testing.

3. **Test Run** — available whenever at least one event exists (no publish
   guard). Opens a dialog to pick an event, then executes all action steps in
   sequence with the chosen payload.

4. **Publish/Unpublish** — toggles live execution. Completely separate from
   event capture and testing.

5. **Removed:** "Generate Test Event" button, `POST /:id/emit-test-event`
   route, `POST /:id/trigger-snapshot` route, `getTestTriggerEvent` engine
   function.

## Data model

New `trigger_events` table in D1/Drizzle. See [PLAN-01-db-schema.md](./PLAN-01-db-schema.md).

Keyed by `(workflowId, triggerKey)` where `triggerKey` is the Pipedream
component key (e.g. `"gmail-new-email"`). This is stable across republishing
because it identifies the *type* of trigger, not the deployed instance.

## Implementation phases

| Phase | File | Scope |
|---|---|---|
| [01](./PLAN-01-db-schema.md) | DB schema + migration | New table, store/list functions |
| [02](./PLAN-02-backend.md) | Backend routes + engine | New routes, remove old ones, update capture logic |
| [03](./PLAN-03-frontend-service.md) | Frontend services | API client + WorkflowService methods |
| [04](./PLAN-04-frontend-ui.md) | UI | Rename button, countdown, event picker dialog, decouple Test Run |
| [05](./PLAN-05-chat.md) | Chat component | Rename TryTriggerComponent, update system prompt |
| [06](./PLAN-06-published-workflows-page.md) | Published Workflows page | Replace Pipedream API source with our own DB; rename page from "Deployed Triggers" |
