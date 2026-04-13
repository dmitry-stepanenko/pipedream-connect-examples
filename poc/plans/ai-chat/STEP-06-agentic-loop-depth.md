# STEP-06 — Verify/Configure Agentic Loop Depth (maxSteps)

## Problem

The reference implementation uses a custom agentic loop with `maxSteps: 20`. A full Pipedream tool workflow can require 5-10+ sequential tool calls:

```
Step 1:  WHAT_ARE_YOU_TRYING_TO_DO
Step 2:  SELECT_APPS
Step 3:  begin_configuration_slack_send_message
Step 4:  ASYNC_OPTIONS_channel
Step 5:  configure_component (set channel)
Step 6:  ASYNC_OPTIONS_text  (if dynamic)
Step 7:  configure_component (set text)
Step 8:  run_slack_send_message
Step 9:  (AI generates final text response)
```

For multi-integration workflows (e.g., "when a GitHub issue is created, send a Slack message and create a Jira ticket"), this chain easily doubles.

**Reference** (`tmp-mcp-chat-example/app/(chat)/api/chat/route.ts:121`):
```typescript
maxSteps: 20,
```

**Reference** (`tmp-mcp-chat-example/app/(chat)/api/chat/streamText.ts:33`):
```typescript
for (let steps = 0; steps < maxSteps; steps++) {
  // ...
  resolve(event.finishReason === "tool-calls")  // continue loop only on tool-calls
}
```

The POC uses Hashbrown's `uiChatResource`, which handles the agentic loop internally. We need to verify:
1. What is Hashbrown's default `maxSteps` (or equivalent)?
2. Can it be configured?
3. Does it match the reference's 20-step depth?

## Investigation Required

### Check Hashbrown's agentic loop behavior

Look at the Hashbrown source code to understand:

1. **`uiChatResource` internals**: How does it handle tool call results? Does it automatically loop (send tool results back to the LLM for another turn)?

2. **Max iterations**: Is there a configurable limit? Search for:
   - `maxSteps`, `maxIterations`, `maxRounds`, `maxTurns` in Hashbrown source
   - Any hardcoded loop limits

3. **Configuration**: Can `uiChatResource` accept a `maxSteps` option?

**Hashbrown source locations** (from the installed npm package or the fork):
- `/Users/dmitry/projects/forks/hashbrown/packages/angular/src/`
- `/Users/dmitry/projects/forks/hashbrown/packages/core/src/`

Search for the agentic loop implementation — it's likely in the core package under something like `chat.ts`, `agent.ts`, or `completions.ts`.

## Changes Required (conditional)

### If Hashbrown supports `maxSteps` configuration:

Add it to the `uiChatResource` config in `chat-panel.ts`:

```typescript
chat = uiChatResource({
  model: 'gpt-4o@2025-01-01-preview',
  debugName: 'workflow-chat',
  maxSteps: 20,   // <-- match reference
  // ...
});
```

### If Hashbrown has a default that's already >= 20:

No change needed. Document the finding in the summary.

### If Hashbrown has a low default and no configuration:

Options, in order of preference:
1. Check if there's a global Hashbrown config for this (via `provideHashbrown()`)
2. Open a PR / issue on Hashbrown to add the option
3. Work around it by using a lower-level Hashbrown API that gives more control

### If Hashbrown doesn't loop at all:

This would be a fundamental blocker. The tool-call → tool-result → next-LLM-turn cycle is the core of agentic behavior. If Hashbrown doesn't do this automatically, we'd need to implement the loop manually (similar to the reference's `streamText.ts`).

## Verification

1. Trigger a multi-step tool chain (e.g., "send a Slack message to #general saying hello")
2. Count the tool call round-trips in the Network tab
3. Confirm the full chain completes (WHAT_ARE_YOU_TRYING_TO_DO → SELECT_APPS → begin_configuration → configure → run)
4. Try a workflow that requires more steps (multi-integration) and confirm it doesn't cut off prematurely

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` | Add `maxSteps: 20` to `uiChatResource` config (if supported) |
