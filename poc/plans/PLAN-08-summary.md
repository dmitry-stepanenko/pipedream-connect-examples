# PLAN-08 Summary — AI Chat via Hashbrown + Pipedream MCP

## Status

**Complete** — builds successfully (`nx build myapp`, `nx build api`). Functional testing requires configuring Azure OpenAI credentials and verifying the Pipedream MCP URL format.

## Files Created

| File | Description |
|------|-------------|
| `libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | MCP client service — connects to Pipedream MCP via the API proxy, discovers tools dynamically, wraps them as hashbrown `createTool` instances |
| `libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` | Chat panel component using `uiChatResource` — includes `ChatMarkdown` and `WorkflowSuggestionCard` exposed components, plus client-side workflow tools |
| `libs/connect-angular/src/lib/components/chat-panel/chat-panel.css` | Chat panel styles |

## Files Modified

| File | Changes |
|------|---------|
| `package.json` | Added `@hashbrownai/core`, `@hashbrownai/angular`, `@hashbrownai/azure`, `@modelcontextprotocol/sdk`, `ngx-markdown`, `marked` |
| `apps/api/src/main.ts` | Added `POST /api/chat` (HashbrownAzure streaming proxy), `POST/GET/DELETE /api/mcp` (Pipedream MCP proxy) |
| `libs/connect-angular/src/index.ts` | Exported `PipedreamMcpService` and `ChatPanelComponent` |
| `apps/myapp/src/app/app.config.ts` | Added `provideHashbrown({ baseUrl })` |
| `libs/connect-angular/src/lib/components/workflow-builder/workflow-builder.ts` | Added `ChatPanelComponent` import, `panelTab` signal |
| `libs/connect-angular/src/lib/components/workflow-builder/workflow-builder.html` | Replaced static right panel with tabbed panel (Step Details / AI Chat) |
| `libs/connect-angular/src/lib/components/workflow-builder/workflow-builder.css` | Added tab styles, flex layout for panel content |

## Corrections vs Plan

1. **Azure instead of Anthropic** — used `@hashbrownai/azure` + `HashbrownAzure.stream.text()` instead of `@hashbrownai/anthropic`. Model format is `deploymentName@apiVersion` (e.g. `gpt-4o@2024-11-20`).
2. **No separate chat sidebar** — chat is integrated into the workflow builder's right panel as a switchable tab alongside step details, rather than a standalone sidebar.
3. **Tools passed inline** — `uiChatResource` expects `Tools[]` (plain array), not a signal. MCP tools are spread from the signal value inline (`...this.mcpService.tools()`), matching the hashbrown Spotify sample pattern.
4. **Backend URL is a stub** — user configures `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` in `.env` manually.

## Design Decisions

- **Tab-based UI**: The right panel in the workflow builder now has "Step Details" and "AI Chat" tabs. This keeps the chat contextually co-located with the builder without requiring extra screen real estate.
- **Client-side tool execution**: Hashbrown handles the agentic loop client-side — the server is a thin LLM proxy. MCP tools call the API proxy, workflow tools call `WorkflowService` directly.
- **MCP proxy**: Browser connects to `/api/mcp?externalUserId=xxx`, which forwards to `https://mcp.pipedream.com/{externalUserId}`. This keeps Pipedream credentials server-side and avoids CORS issues.

## Open Issues

- **Pipedream MCP URL**: Assumed `https://mcp.pipedream.com/{externalUserId}` — needs verification against actual docs at `https://mcp.pipedream.com/developers`.
- **Azure model string**: Hardcoded to `gpt-4o@2024-11-20` in the chat panel — should be configurable via environment or DI token.
- **MCP connection timing**: `PipedreamMcpService.connect()` is not called automatically — the app needs to call it (e.g. in `ngOnInit` of a parent component or via a "Connect" button).
- **CommonJS warnings**: `ajv` and `ajv-formats` from `@modelcontextprotocol/sdk` trigger Angular build warnings about non-ESM modules. Functional but noisy.
