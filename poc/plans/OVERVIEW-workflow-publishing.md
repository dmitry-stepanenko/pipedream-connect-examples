# Workflow Publishing — Architecture Overview

## How it works today

Users build workflows in the Angular UI. Each workflow has:

- **One trigger** (first step) — either a custom business event (e.g. "Order Created") or a Pipedream app trigger (e.g. "New Slack Message")
- **One or more action steps** — Pipedream app actions (e.g. "Send Slack Message", "Create GitHub Issue")

All data lives in `localStorage`. Nothing reaches Pipedream.

---

## Relevant Pipedream Connect APIs

Pipedream Connect does **not** support creating arbitrary multi-step workflows via API. However, it provides two primitives that let us orchestrate the same result from our own server:

### 1. Deploy Trigger (`POST /connect/{project_id}/triggers/deploy`)

Deploys a Pipedream trigger (event source) for a specific end user. The trigger listens for events (e.g. new Slack message, new GitHub issue) and delivers them to a **webhook URL** we control.

- Requires `id` (trigger component key), `external_user_id`, and `configured_props`
- Connected accounts are referenced via `authProvisionId` (the `apn_*` account ID from managed auth)
- Supports a `webhook_url` field — Pipedream POSTs events to this URL with an `x-pd-signature` header for verification
- Returns a deployed trigger ID (`dc_*`) for lifecycle management (pause, update, delete)

### 2. Run Action (`POST /connect/{project_id}/actions/run`)

Executes a single Pipedream action on demand, on behalf of an end user. No pre-built workflow required.

- Requires `id` (action component key), `external_user_id`, and `configured_props`
- Returns `exports` (named outputs), `os` (logs), and `ret` (return value)
- Each call is stateless and independent

### 3. Managed Auth (existing)

Users connect their third-party accounts (Slack, GitHub, Google, etc.) via the frontend SDK's `connectAccount()` flow. Each connected account gets an `apn_*` ID that is passed in `configured_props` when deploying triggers or running actions.

---

## Proposed publishing flow

### Pipedream app triggers

When a workflow's trigger is a Pipedream app trigger (e.g. "New GitHub Issue"):

```
User clicks "Publish"
        │
        ▼
  Our API server
        │
        ├── 1. Deploy trigger via Connect API
        │      POST /connect/{project_id}/triggers/deploy
        │      - id: trigger component key (from workflow step data)
        │      - external_user_id: the user
        │      - configured_props: trigger config (including authProvisionId)
        │      - webhook_url: our server's webhook endpoint
        │
        │   Pipedream starts listening for events
        │   and POSTs them to our webhook_url
        │
        ▼
  Event arrives at our webhook
        │
        ├── 2. For each action step (in order):
        │      POST /connect/{project_id}/actions/run
        │      - id: action component key
        │      - external_user_id: the user
        │      - configured_props: action config (including authProvisionId)
        │
        ▼
  Workflow execution complete
```

### Custom triggers

When a workflow's trigger is a custom business event (e.g. "Order Created"):

```
Our app fires the event internally
(e.g. an order is placed)
        │
        ▼
  Our API server looks up workflows
  that use this custom trigger
        │
        ├── For each matching workflow:
        │     For each action step (in order):
        │       POST /connect/{project_id}/actions/run
        │       - id: action component key
        │       - external_user_id: the workflow owner
        │       - configured_props: action config
        │
        ▼
  Done
```

No Pipedream trigger deployment needed — our server is the event source.

---

## What changes in our system

### Server side (API)

- **Workflow persistence** — workflows must be stored server-side (database or file), not just in the browser. The server needs them to execute action chains when triggers fire.
- **Publish endpoint** — accepts a workflow, deploys its Pipedream trigger (if applicable), and marks the workflow as active.
- **Webhook receiver** — receives events from deployed Pipedream triggers, looks up the associated workflow, and runs its action steps in sequence.
- **Custom trigger endpoint** — receives custom business events from our own systems and runs matching workflows.
- **Unpublish endpoint** — deletes the deployed trigger via Connect API and marks the workflow as inactive.

### Client side (Angular)

- **Publish/unpublish buttons** in the workflow builder UI.
- **Workflow status** — display whether a workflow is draft or published.
- **Account connection** — the `connectAccount()` flow already exists via `PipedreamClientService`. The `authProvisionId` is stored in `configured_props` when users configure app fields.

---

## What Pipedream handles vs. what we handle

| Concern | Pipedream | Our server |
|---------|-----------|------------|
| Listening for third-party events (triggers) | Yes — deployed trigger watches the external service | — |
| Delivering trigger events | Yes — POSTs to our webhook URL | Receives the webhook |
| Executing individual actions | Yes — `actions/run` calls the third-party API | Calls `actions/run` for each step |
| Orchestrating multi-step sequences | — | Yes — iterates through action steps |
| OAuth token management | Yes — managed auth handles refresh | — |
| Workflow storage & state | — | Yes — persists workflows, tracks published status |
| Custom business event routing | — | Yes — matches events to workflows |

---

## Open questions

1. **Error handling in action chains** — if step 2 of 4 fails, do we retry? Skip? Abort the chain? Pipedream's `actions/run` returns errors per-call, so we need a strategy.
2. **Passing data between steps** — can action step 2 use outputs from step 1? The `actions/run` response includes `exports` and `ret`, so our orchestrator could inject previous step outputs into `configured_props`, but the UI would need a way to reference them (e.g. `{{steps.step1.exports.messageId}}`).
3. **Server-side persistence** — what storage to use for workflows? A database, or flat files for this POC?
4. **Webhook security** — Pipedream signs webhook payloads with `x-pd-signature`. We should verify these.

---

## Sources

- [Deploying Triggers](https://pipedream.com/docs/connect/components/triggers)
- [Deploy Trigger API](https://pipedream.com/docs/connect/api-reference/deploy-trigger)
- [Executing Actions](https://pipedream.com/docs/connect/components/actions)
- [Run Action API](https://pipedream.com/docs/connect/api-reference/run-action)
- [Running Workflows for End Users](https://pipedream.com/docs/connect/workflows)
- [Managed Auth Quickstart](https://pipedream.com/docs/connect/managed-auth/quickstart)
- [Webhook Configuration](https://pipedream.com/docs/connect/api-reference/update-trigger-webhooks)
- [List Accounts API](https://pipedream.com/docs/connect/api-reference/list-accounts)
