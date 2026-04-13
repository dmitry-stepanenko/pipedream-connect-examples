# STEP-04 — Add Tool Execution Timeout (180s)

## Problem

The reference implementation wraps every MCP tool call with a 180-second (3-minute) timeout using `AbortController`. The POC has no timeout — a stuck MCP call will hang the chat indefinitely.

**Reference** (`tmp-mcp-chat-example/mods/mcp-client.ts:253-300`):
```typescript
private async executeTool(
  name: string,
  args: unknown,
  options: ToolExecutionOptions
): Promise<CallToolResult> {
  const abortController = new AbortController()

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", () => {
      abortController.abort()
    })
  }

  let timeoutId: NodeJS.Timeout | null = null
  if (options.timeout) {
    timeoutId = setTimeout(() => {
      abortController.abort()
    }, options.timeout)
  }

  try {
    const result = await this.client.callTool({ name, arguments: args })

    if (timeoutId) clearTimeout(timeoutId)
    return result
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error("Tool execution aborted or timed out")
    }
    throw error
  }
}
```

And the timeout is set at 180,000ms in `convertTools()`:
```typescript
execute: async (args, options) => {
  return this.executeTool(mcpTool.name, args, {
    timeout: 180_000, // 3 minutes
    ...options,
  })
},
```

**POC** (`pipedream-mcp.service.ts:49-54`):
```typescript
handler: async (input) => {
  const result = await this.client?.callTool({
    name: tool.name,
    arguments: input,
  });
  return result;   // <-- no timeout, no abort
},
```

## Changes Required

### `PipedreamMcpService` — wrap `callTool` with timeout

**File**: `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`

Add a helper method and use it in every tool handler:

```typescript
private static readonly TOOL_TIMEOUT_MS = 180_000; // 3 minutes, matching reference

private async executeTool(name: string, args: unknown): Promise<unknown> {
  if (!this.client) {
    throw new Error('MCP client not connected');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PipedreamMcpService.TOOL_TIMEOUT_MS,
  );

  try {
    const result = await this.client.callTool(
      { name, arguments: args },
    );
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Tool "${name}" timed out after ${PipedreamMcpService.TOOL_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Then update the tool handlers (in both `connect()` and `refreshTools()`) to use it:

```typescript
handler: async (input) => {
  const result = await this.executeTool(tool.name, input);
  await this.refreshTools();
  return result;
},
```

### Note on AbortController + MCP SDK

The `@modelcontextprotocol/sdk` `Client.callTool()` may or may not accept an `AbortSignal`. If it does, pass `{ signal: controller.signal }` as an option. If not, the timeout still works as a race — `setTimeout` fires and throws, aborting the handler's Promise chain. The MCP request itself may continue on the wire, but the chat loop moves on.

Check the MCP SDK's `callTool` signature:
```typescript
// If it supports signal:
await this.client.callTool({ name, arguments: args }, { signal: controller.signal });

// If not, the timeout wrapping alone is sufficient
```

## Verification

1. If you can simulate a slow MCP tool (e.g., by adding a proxy delay), confirm the tool call is aborted after 3 minutes
2. For normal operations, confirm tool calls complete successfully without timeout interference
3. Check that the error message ("Tool X timed out...") appears in the chat as an error message if a timeout occurs

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | Add `executeTool()` method with 180s timeout, update tool handlers |
