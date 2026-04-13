# STEP-01 — Fix MCP Header Name + Stable Conversation ID

## Problem

Two issues with how the POC identifies conversations to the Pipedream MCP server:

### 1. Wrong header name

The reference uses `x-pd-mcp-chat-id` to identify a conversation. The POC sends `x-pd-conversation-id`. The Pipedream MCP server uses this header to restore tool state between requests (it's stateless — the header is the only way it knows which tool context to load).

**Reference** (`tmp-mcp-chat-example/mods/mcp-client.ts:149-158`):
```typescript
const transport = new StreamableHTTPClientTransport(
  new URL(this.serverUrl),
  {
    requestInit: {
      headers: {
        "x-pd-mcp-chat-id": this.chatId,   // <-- correct header
        ...headers,
      }
    } as RequestInit,
  }
);
```

**POC** (`pipedream-mcp.service.ts:28-35`):
```typescript
const conversationId = crypto.randomUUID();
await this.client.connect(new StreamableHTTPClientTransport(mcpUrl, {
  requestInit: {
    headers: {
      'x-pd-conversation-id': conversationId,   // <-- wrong header name
    },
  },
}));
```

### 2. Unstable conversation ID

The POC generates a new `crypto.randomUUID()` on every `connect()` call. This means:
- If the MCP connection drops and reconnects, tool state is lost
- The chat ID should be stable for the lifetime of a conversation

In the reference, the chat `id` (a stable identifier for the conversation) is passed to the `MCPSessionManager` constructor and reused for every request.

## Changes Required

### A. `PipedreamMcpService` — accept a stable chat ID and use correct header

**File**: `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`

1. Add a `chatId` parameter to `connect()` (or generate one once and store it as instance state, not per-call).
2. Change header from `x-pd-conversation-id` to `x-pd-mcp-chat-id`.

```typescript
// Before
async connect() {
  // ...
  const conversationId = crypto.randomUUID();
  await this.client.connect(new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: {
        'x-pd-conversation-id': conversationId,
      },
    },
  }));
  // ...
}

// After
private chatId = crypto.randomUUID(); // stable for service lifetime

async connect(chatId?: string) {
  if (chatId) this.chatId = chatId;

  // ...
  await this.client.connect(new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: {
        'x-pd-mcp-chat-id': this.chatId,
      },
    },
  }));
  // ...
}
```

### B. API proxy — forward `x-pd-mcp-chat-id` instead of `x-pd-conversation-id`

**File**: `poc/apps/api/src/main.ts`

The proxy currently reads and forwards `x-pd-conversation-id`. Update it to use `x-pd-mcp-chat-id`:

```typescript
// Before (main.ts:118)
const conversationId = req.headers['x-pd-conversation-id'] as string | undefined;
// ...
if (conversationId) extra['x-pd-conversation-id'] = conversationId;

// After
const chatId = req.headers['x-pd-mcp-chat-id'] as string | undefined;
// ...
if (chatId) extra['x-pd-mcp-chat-id'] = chatId;
```

Apply the same change to the DELETE handler.

## Verification

1. Start the API server, open browser DevTools Network tab
2. Trigger a chat message
3. Inspect the MCP proxy request — confirm the header is `x-pd-mcp-chat-id` (not `x-pd-conversation-id`)
4. Send a second message in the same chat — confirm the same chat ID is used
5. The MCP server should be able to restore tool context between requests

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | Rename header, stabilize ID |
| `poc/apps/api/src/main.ts` | Update proxy header forwarding (POST + DELETE handlers) |
