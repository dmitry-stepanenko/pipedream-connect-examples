# STEP-02 — Fix Tool Schema Conversion (Preserve `required` from MCP Server)

## Problem

When converting MCP tools to Hashbrown tools, the POC forces **all** properties to be required:

**POC** (`pipedream-mcp.service.ts:44-48`):
```typescript
schema: {
  ...tool.inputSchema,
  additionalProperties: false,
  required: Object.keys(tool.inputSchema.properties ?? {}),  // <-- WRONG
},
```

This overrides whatever `required` array the MCP server actually specifies. Many Pipedream MCP tools have optional properties — marking them all required causes the AI to:
- Hallucinate values for optional parameters it doesn't have information for
- Fail validation when it omits an actually-optional field
- Send garbage data to APIs (e.g., filling in a random Slack channel ID when the field is optional)

**Reference** (`tmp-mcp-chat-example/mods/mcp-client.ts:231-234`):
```typescript
tools[mcpTool.name] = tool({
  description: mcpTool.description || "",
  parameters: jsonSchema(mcpTool.inputSchema),  // <-- preserves schema as-is
  // ...
});
```

The reference uses Vercel AI SDK's `jsonSchema()` wrapper which passes the schema through unchanged, including the original `required` array (or absence thereof).

## Changes Required

### `PipedreamMcpService` — preserve original `required` field

**File**: `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`

In the `connect()` method where tools are mapped, change the schema construction:

```typescript
// Before
schema: {
  ...tool.inputSchema,
  additionalProperties: false,
  required: Object.keys(tool.inputSchema.properties ?? {}),
},

// After
schema: {
  ...tool.inputSchema,
  additionalProperties: false,
  // Preserve the server's required array. If the server omits it,
  // default to empty (no properties required) rather than all.
  ...(tool.inputSchema.required
    ? { required: tool.inputSchema.required }
    : {}),
},
```

### Why keep `additionalProperties: false`?

This is correct — Hashbrown/most LLM tool calling frameworks require `additionalProperties: false` to prevent the model from inventing extra fields. The reference achieves this implicitly via `jsonSchema()`. We keep it explicit.

## Verification

1. Connect to MCP, check the tools signal in Angular DevTools
2. Inspect a tool that has optional properties (e.g., many `begin_configuration_*` tools)
3. Confirm `required` only lists the actually-required properties, not all of them
4. Send a chat message that triggers a tool call — confirm the AI doesn't hallucinate values for optional fields

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | Fix `required` field in schema conversion |
