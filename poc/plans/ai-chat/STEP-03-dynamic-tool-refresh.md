# STEP-03 — Dynamic Tool Re-Fetching Between Agentic Steps

## Problem

This is the most critical gap. Pipedream MCP tools are **dynamic** — the available tools change after certain tool calls:

```
Initial tools:    WHAT_ARE_YOU_TRYING_TO_DO
                        ↓ (call it)
New tools appear: SELECT_APPS
                        ↓ (call it)
New tools appear: begin_configuration_slack_send_message, begin_configuration_github_create_issue, ...
                        ↓ (call one)
New tools appear: configure_component, ASYNC_OPTIONS_*, run_*, abort_configuration_*
                        ↓ (configure + run)
Back to:          WHAT_ARE_YOU_TRYING_TO_DO (cycle restarts)
```

The reference re-fetches the tool list on **every iteration** of the agentic loop:

**Reference** (`tmp-mcp-chat-example/app/(chat)/api/chat/streamText.ts:33-35`):
```typescript
for (let steps = 0; steps < maxSteps; steps++) {
  const cont = await new Promise<boolean>(async (resolve, reject) => {
    const tools = await getTools()   // <-- fresh tools every step
    // ...
```

**Reference** (`tmp-mcp-chat-example/app/(chat)/api/chat/route.ts:124`):
```typescript
getTools: () => mcpSession.tools({ useCache: false }),  // <-- never cached
```

The POC fetches tools **once** in `connect()` and stores them in a signal:

**POC** (`pipedream-mcp.service.ts:37-60`):
```typescript
const { tools: mcpTools } = await this.client.listTools();
// ... map to createTool ...
this.tools.set(tools);  // set once, never updated
```

And the chat resource reads the signal once at construction:

**POC** (`chat-panel.ts:275-281`):
```typescript
tools: [
  ...this.mcpService.tools(),       // <-- snapshot at construction time
  this.createWorkflowTool,
  // ...
],
```

This means after calling `WHAT_ARE_YOU_TRYING_TO_DO`, the new `SELECT_APPS` tool never appears. The entire Pipedream tool configuration workflow is broken.

## Approach

The fix requires two changes:

1. **`PipedreamMcpService`**: Add a `refreshTools()` method that re-calls `listTools()` and updates the signal
2. **`ChatPanelComponent`**: Ensure the tool list passed to `uiChatResource` stays reactive to MCP tool changes

### Hashbrown's tool reactivity

The `uiChatResource` accepts a `tools` property. We need to verify how Hashbrown handles tool list updates between agentic steps. There are two possible scenarios:

**Scenario A — Hashbrown supports reactive tools (signal/computed):**
If `uiChatResource` reads tools reactively on each step, we just need `refreshTools()` to update the signal and a way to trigger it after each tool call.

**Scenario B — Hashbrown reads tools once:**
If tools are snapshot at creation time, we need to hook into Hashbrown's tool execution lifecycle. Each MCP tool handler should call `refreshTools()` after executing, so the next agentic step sees updated tools.

The most robust approach (works for both scenarios): **refresh tools inside every MCP tool handler, after calling `callTool()`**.

## Changes Required

### A. `PipedreamMcpService` — add `refreshTools()` method

**File**: `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`

```typescript
// Add this method to PipedreamMcpService:

async refreshTools(): Promise<void> {
  if (!this.client) return;

  const { tools: mcpTools } = await this.client.listTools();

  const tools = mcpTools.map((tool) => {
    return runInInjectionContext(this.injector, () => {
      return createTool({
        name: tool.name,
        description: tool.description ?? '',
        schema: {
          ...tool.inputSchema,
          additionalProperties: false,
          ...(tool.inputSchema.required
            ? { required: tool.inputSchema.required }
            : {}),
        },
        handler: async (input) => {
          const result = await this.client?.callTool({
            name: tool.name,
            arguments: input,
          });
          // After each tool call, refresh the tool list
          // because Pipedream MCP dynamically adds/removes tools
          await this.refreshTools();
          return result;
        },
      });
    });
  });

  this.tools.set(tools);
}
```

### B. Update `connect()` to use the same pattern

**File**: `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`

Refactor `connect()` to call `refreshTools()` after establishing the connection, avoiding code duplication:

```typescript
async connect(chatId?: string) {
  if (chatId) this.chatId = chatId;

  this.client = new Client({
    name: 'pipedream',
    version: '1.0.0',
  });

  const apiBase = this.config.tokenEndpointUrl.replace('/api/pipedream/token', '');
  const mcpUrl = new URL(
    `${apiBase}/api/mcp?externalUserId=${encodeURIComponent(this.config.externalUserId)}`,
  );

  await this.client.connect(new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: {
        'x-pd-mcp-chat-id': this.chatId,
      },
    },
  }));

  await this.refreshTools();   // <-- initial tool discovery
  this.connected.set(true);
}
```

### C. `ChatPanelComponent` — make tools reactive

**File**: `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts`

The `tools` property of `uiChatResource` must read the signal reactively. Check if the current `...this.mcpService.tools()` spread is inside a `computed` or directly in the config object:

```typescript
// Current (snapshot — tools frozen at creation):
tools: [
  ...this.mcpService.tools(),
  this.createWorkflowTool,
  // ...
],

// If uiChatResource supports a function/signal for tools:
tools: () => [
  ...this.mcpService.tools(),
  this.createWorkflowTool,
  // ...
],

// Or use computed if uiChatResource accepts a signal:
tools: computed(() => [
  ...this.mcpService.tools(),
  this.createWorkflowTool,
  // ...
]),
```

**Important**: Check the Hashbrown source/docs to determine which form `uiChatResource` accepts. If it only accepts a static array, we may need to look at alternative approaches (e.g., recreating the chat resource, or using a lower-level Hashbrown API).

### D. Tool handler: refresh after every MCP tool call

This is the belt-and-suspenders approach. Even if the tool list is reactive, we trigger a refresh after each MCP tool execution because Pipedream's tool list changes are a side effect of tool calls, not of message turns.

This is already shown in the `refreshTools()` method above — each tool's handler calls `await this.refreshTools()` after `callTool()`.

**Caveat**: This creates a brief async gap where the tool list updates mid-step. The next agentic iteration will see the updated tools. There's a small risk of a race condition if Hashbrown starts the next step before `refreshTools()` completes. To mitigate: ensure the tool handler's Promise doesn't resolve until refresh is done.

## Verification

1. Start the app, open the chat panel
2. Send a message like "Send a Slack message to #general"
3. Watch the Network tab — after the initial `listTools`, you should see another `listTools` call after `WHAT_ARE_YOU_TRYING_TO_DO` executes
4. The AI should proceed to call `SELECT_APPS`, then see integration-specific tools
5. The full chain (WHAT_ARE_YOU_TRYING_TO_DO → SELECT_APPS → begin_configuration → configure → run) should complete without the AI saying "I don't have that tool"

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | Add `refreshTools()`, refactor `connect()`, add post-call refresh in handlers |
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` | Make tools reactive (computed/function) |
