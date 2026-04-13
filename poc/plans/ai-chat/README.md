# AI Chat — Alignment with Pipedream MCP Reference Implementation

## Goal

Align the existing AI chat implementation (PLAN-08) with the official Pipedream MCP chat reference at `/Users/dmitry/projects/temp/tmp-mcp-chat-example`. The reference is a Next.js app using Vercel AI SDK; our POC is an Angular app using Hashbrown. The transport layer differs, but the MCP integration patterns, headers, tool handling, and system prompt must match.

## Context

PLAN-08 delivered a working chat panel with MCP tool discovery, but it was built from the Hashbrown samples (Spotify, smart-home) rather than the Pipedream-specific reference. Comparing the two reveals several gaps — from wrong header names to missing dynamic tool re-fetching — that will cause Pipedream's multi-step tool workflow to fail silently.

### Reference Architecture (what we must match)

```
Next.js API Route (server-side)
  ├── MCPSessionManager
  │     ├── connect() → StreamableHTTPClientTransport
  │     │     headers: Authorization, x-pd-project-id, x-pd-environment,
  │     │              x-pd-external-user-id, x-pd-tool-mode, x-pd-app-discovery,
  │     │              x-pd-mcp-chat-id
  │     ├── tools({ useCache: false }) → called EVERY agentic step
  │     │     └── listTools() → convertTools() → jsonSchema(inputSchema)
  │     └── executeTool() → callTool() with 180s timeout + AbortController
  │
  └── streamText (custom agentic loop)
        ├── maxSteps: 20
        ├── getTools: () => mcpSession.tools({ useCache: false })
        ├── Loop: continues on finishReason === "tool-calls"
        └── Stops on: "stop", "content-filter", "error"
```

### Our Architecture (Angular + Hashbrown)

```
Angular App (browser)
  ├── PipedreamMcpService
  │     └── MCP Client → /api/mcp proxy → remote.mcp.pipedream.net
  └── ChatPanelComponent
        └── uiChatResource → /api/chat → Azure OpenAI

Express API (server)
  ├── POST /api/chat  → HashbrownAzure → Azure OpenAI
  └── POST /api/mcp   → proxy to Pipedream MCP (injects auth headers)
```

The MCP client runs in the browser (proxied) vs. server-side in the reference. This is an intentional architectural choice — the proxy injects auth. What must change is the protocol-level behavior: headers, tool refresh, schema handling, timeouts, and system prompt.

## Reference Files

- **Reference repo**: `/Users/dmitry/projects/temp/tmp-mcp-chat-example/`
  - `mods/mcp-client.ts` — `MCPSessionManager` class (connect, tools, executeTool)
  - `lib/pd-backend-client.ts` — `pdHeaders()` helper (all required Pipedream headers)
  - `lib/ai/prompts.ts` — system prompt with tool workflow instructions
  - `app/(chat)/api/chat/route.ts` — chat API route (creates MCP session per request)
  - `app/(chat)/api/chat/streamText.ts` — custom agentic loop (maxSteps, tool re-fetch)
- **Our POC**:
  - `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` — MCP service
  - `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` — chat component
  - `poc/apps/api/src/main.ts` — Express API with MCP proxy

## Execution Order

| Step | Description | Depends on | Notes |
|------|-------------|------------|-------|
| [STEP-01](STEP-01-mcp-headers.md) | Fix MCP header name + stable conversation ID | — | |
| [STEP-02](STEP-02-tool-schema.md) | Fix tool schema conversion (preserve `required`) | — | |
| [STEP-03](STEP-03-dynamic-tool-refresh.md) | Dynamic tool re-fetching between agentic steps | STEP-01 | Critical for Pipedream tool workflow |
| [STEP-04](STEP-04-tool-timeout.md) | Add tool execution timeout (180s) | — | |
| [STEP-05](STEP-05-system-prompt.md) | Align system prompt with Pipedream tool workflow | — | |
| [STEP-06](STEP-06-agentic-loop-depth.md) | Verify/configure agentic loop depth (maxSteps) | STEP-03 | |

Steps 01, 02, 04, 05 are independent and can be implemented in parallel.
Step 03 depends on 01 (correct headers needed for tool refresh to work).
Step 06 depends on 03 (must understand how tool refresh interacts with the loop).

## Key Differences Summary

| Aspect | Reference | POC (current) | Impact |
|--------|-----------|----------------|--------|
| MCP chat header | `x-pd-mcp-chat-id` (stable per chat) | `x-pd-conversation-id` (random UUID each connect) | MCP server can't restore tool state |
| Tool re-fetch | Every agentic step (`useCache: false`) | Once at connect time | Dynamic tools (SELECT_APPS, begin_configuration_*) never appear |
| Schema `required` | Preserved from MCP server (`jsonSchema()`) | All properties forced required | AI hallucinates values for optional params |
| Tool timeout | 180s with AbortController | None | Stuck calls hang forever |
| System prompt | Detailed Pipedream tool workflow instructions | Generic workflow builder instructions | AI doesn't know WHAT_ARE_YOU_TRYING_TO_DO flow |
| maxSteps | 20 (explicit agentic loop) | Hashbrown default (unknown) | May not support deep tool chains |

## Instructions for AI Agents

- Read each step file fully before implementing — they contain the exact code locations and diffs.
- The reference repo at `/Users/dmitry/projects/temp/tmp-mcp-chat-example/` is read-only. Never modify it.
- After implementing all steps, write a summary file and update `NEXT-STEPS.md` per the main plans/README.md instructions.
