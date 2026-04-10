# PLAN-08 — Phase 2: AI Chat via Hashbrown + Pipedream MCP

## Goal

Add an AI chat panel to the workflow builder using **Hashbrown** (`@hashbrownai/angular` + `@hashbrownai/anthropic`). The user describes what they want in natural language ("notify Slack when an order is created") and the AI assembles workflow steps automatically, using Pipedream's MCP server to browse apps and components.

## Context

- **Hashbrown** is an open-source framework for embedding AI chat in Angular/React apps. It handles streaming, tool calling, and UI rendering out of the box.
- Pipedream MCP server: `https://mcp.pipedream.com/{externalUserId}` — exposes Pipedream's catalog as MCP tools
- The Express API (`poc/apps/api/`) acts as a **proxy** for both:
  1. The LLM (Anthropic Claude) — hashbrown's `/api/chat` endpoint using `HashbrownAnthropic.stream.text()`
  2. The MCP server — forwarding `/api/mcp` requests to Pipedream's MCP server (keeps credentials server-side)
- On the Angular side, hashbrown's `uiChatResource` drives the chat. MCP tools are discovered dynamically via `@modelcontextprotocol/sdk` client connecting to the proxy, then passed as hashbrown tools.
- PLAN-07 must be complete (full manual workflow builder working)

## Reference Samples

All patterns are taken from the hashbrown repo at `/Users/dmitry/projects/forks/hashbrown/samples/`:

| Pattern | Sample | Key files |
|---------|--------|-----------|
| Angular chat with `uiChatResource` | `smart-home/angular/` | `app/chat/chat-panel.ts`, `app/chat/tools/*.ts` |
| Server-side `HashbrownAnthropic` streaming | (adapt from `smart-home/server/src/main.ts` using Anthropic instead of OpenAI) | `packages/anthropic/src/stream/text.fn.ts` |
| MCP client connecting to server, creating tools | `spotify/angular/` | `app/services/mcp-server.ts` |
| MCP proxy server endpoints | `spotify/server/` | `src/main.ts` (POST/GET/DELETE `/mcp`) |
| Chat messages rendering | `smart-home/angular/` | `app/chat/chat-messages.ts`, `app/chat/composer.ts` |
| App config with `provideHashbrown` | `smart-home/angular/` | `app/app.config.ts` |

---

## Architecture

```
Angular App (myapp)
  ├── provideHashbrown({ baseUrl: 'http://localhost:3333/api/chat' })
  ├── PipedreamMcpService
  │     └── MCP Client → http://localhost:3333/api/mcp  (proxy)
  │           └── listTools() → createTool() for each MCP tool
  └── ChatPanelComponent
        └── uiChatResource({
              model: 'claude-sonnet-4-20250514',
              tools: [...mcpTools, ...workflowTools],
              components: [Markdown, WorkflowSuggestionCard],
            })

Express API (api)
  ├── POST /api/chat        → HashbrownAnthropic.stream.text() → Anthropic API
  ├── POST /api/mcp         → proxy to https://mcp.pipedream.com/{userId}
  ├── GET  /api/mcp          → proxy (SSE notifications)
  └── DELETE /api/mcp        → proxy (session cleanup)
```

**How tool calling works in hashbrown:**
1. `uiChatResource` sends messages to `/api/chat`
2. Server streams LLM response back (including tool_use blocks)
3. Hashbrown client intercepts tool calls, executes them locally (client-side)
4. Tool results are sent back to `/api/chat` → LLM continues
5. This loop repeats until the LLM returns a final text/UI response

---

## Step 1 — Install dependencies

```bash
cd poc

# Server-side: Anthropic provider for hashbrown
npm install @hashbrownai/core @hashbrownai/anthropic @anthropic-ai/sdk

# Angular-side: hashbrown Angular + MCP client SDK
npm install @hashbrownai/angular @modelcontextprotocol/sdk

# Markdown rendering (used by hashbrown's exposeMarkdown pattern)
npm install ngx-markdown marked
```

Note: `@hashbrownai/core` is a peer dependency of both `@hashbrownai/angular` and `@hashbrownai/anthropic`.

---

## Step 2 — Add `/api/chat` endpoint (hashbrown LLM proxy)

Add to `poc/apps/api/src/main.ts`:

```typescript
import { HashbrownAnthropic } from '@hashbrownai/anthropic';
import { Chat } from '@hashbrownai/core';

const { ANTHROPIC_API_KEY } = process.env;

// POST /api/chat — hashbrown streaming proxy to Anthropic
app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  const completionParams = req.body as Chat.Api.CompletionCreateParams;

  const response = HashbrownAnthropic.stream.text({
    apiKey: ANTHROPIC_API_KEY,
    request: completionParams,
  });

  res.header('Content-Type', 'application/octet-stream');

  for await (const chunk of response) {
    res.write(chunk);
  }

  res.end();
});
```

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

This endpoint is a thin proxy — hashbrown on the client sends `Chat.Api.CompletionCreateParams`, the server forwards to Anthropic and streams binary frames back. No tool logic lives here; tools execute client-side.

---

## Step 3 — Add `/api/mcp` proxy endpoints

Add MCP proxy routes to `poc/apps/api/src/main.ts`. These relay MCP HTTP transport requests from the browser to Pipedream's MCP server, attaching the necessary credentials.

```typescript
import { createProxyMiddleware } from 'http-proxy-middleware';

// Or implement manually with fetch:

// The Pipedream MCP server URL includes the external user ID.
// The Angular app passes it as a query parameter: /api/mcp?externalUserId=xxx
// The proxy strips it and forwards to https://mcp.pipedream.com/{externalUserId}

app.post('/api/mcp', async (req, res) => {
  const externalUserId = req.query.externalUserId as string;
  if (!externalUserId) {
    res.status(400).json({ error: 'externalUserId query parameter required' });
    return;
  }

  const targetUrl = `https://mcp.pipedream.com/${externalUserId}`;
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    // Forward the session ID header back
    const upstreamSessionId = upstream.headers.get('Mcp-Session-Id');
    if (upstreamSessionId) {
      res.setHeader('Mcp-Session-Id', upstreamSessionId);
    }

    res.status(upstream.status);
    const body = await upstream.text();
    res.send(body);
  } catch (err) {
    console.error('MCP proxy error:', err);
    res.status(502).json({ error: 'MCP proxy request failed' });
  }
});

app.get('/api/mcp', async (req, res) => {
  const externalUserId = req.query.externalUserId as string;
  if (!externalUserId) {
    res.status(400).json({ error: 'externalUserId query parameter required' });
    return;
  }

  const targetUrl = `https://mcp.pipedream.com/${externalUserId}`;
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers,
    });

    const upstreamSessionId = upstream.headers.get('Mcp-Session-Id');
    if (upstreamSessionId) {
      res.setHeader('Mcp-Session-Id', upstreamSessionId);
    }

    // Forward SSE content type if present
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.status(upstream.status);
    const body = await upstream.text();
    res.send(body);
  } catch (err) {
    console.error('MCP proxy error:', err);
    res.status(502).json({ error: 'MCP proxy request failed' });
  }
});

app.delete('/api/mcp', async (req, res) => {
  const externalUserId = req.query.externalUserId as string;
  if (!externalUserId) {
    res.status(400).json({ error: 'externalUserId query parameter required' });
    return;
  }

  const targetUrl = `https://mcp.pipedream.com/${externalUserId}`;
  const sessionId = req.headers['mcp-session-id'] as string;

  try {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    const upstream = await fetch(targetUrl, {
      method: 'DELETE',
      headers,
    });

    res.sendStatus(upstream.status);
  } catch (err) {
    console.error('MCP proxy error:', err);
    res.status(502).json({ error: 'MCP proxy cleanup failed' });
  }
});
```

**Important**: Check the actual Pipedream MCP server URL format and auth requirements at `https://mcp.pipedream.com/developers` before implementing. The URL pattern and auth headers may differ — adjust accordingly.

---

## Step 4 — `PipedreamMcpService` (Angular)

Create `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts`.

This follows the same pattern as `hashbrown/samples/spotify/angular/src/app/services/mcp-server.ts`:

```typescript
import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Chat } from '@hashbrownai/core';
import { createTool } from '@hashbrownai/angular';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';

@Injectable({ providedIn: 'root' })
export class PipedreamMcpService {
  private readonly config = inject(PIPEDREAM_CONFIG);
  private readonly injector = inject(Injector);
  private client?: Client;

  readonly connected = signal(false);
  readonly tools = signal<Chat.AnyTool[]>([]);

  async connect() {
    this.client = new Client({
      name: 'pipedream',
      version: '1.0.0',
    });

    // Derive API base from token endpoint URL
    const apiBase = this.config.tokenEndpointUrl.replace('/api/pipedream/token', '');
    const mcpUrl = new URL(`${apiBase}/api/mcp?externalUserId=${encodeURIComponent(this.config.externalUserId)}`);

    await this.client.connect(
      new StreamableHTTPClientTransport(mcpUrl),
    );

    const { tools: mcpTools } = await this.client.listTools();

    const tools = mcpTools.map((tool) => {
      return runInInjectionContext(this.injector, () => {
        return createTool({
          name: tool.name,
          description: tool.description ?? '',
          schema: {
            ...tool.inputSchema,
            additionalProperties: false,
            required: Object.keys(tool.inputSchema.properties ?? {}),
          },
          handler: async (input) => {
            const result = await this.client?.callTool({
              name: tool.name,
              arguments: input,
            });
            return result;
          },
        });
      });
    });

    this.tools.set(tools);
    this.connected.set(true);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.connected.set(false);
      this.tools.set([]);
    }
  }
}
```

---

## Step 5 — `ChatPanelComponent` (Angular)

Create `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts`.

Uses `uiChatResource` from hashbrown. MCP tools are provided by `PipedreamMcpService`, and additional client-side tools interact with `WorkflowService`.

```typescript
import { Component, computed, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import { exposeComponent, RenderMessageComponent, uiChatResource, createTool, UiChatMessage } from '@hashbrownai/angular';
import { prompt, s } from '@hashbrownai/core';
import { PipedreamMcpService } from '../../services/pipedream-mcp.service';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';

// --- Exposed components for the AI to render ---

@Component({
  selector: 'pd-chat-markdown',
  standalone: true,
  template: `<div [innerHTML]="data()"></div>`,
  styles: [`:host { display: block; } :host ::ng-deep p { margin: 0 0 8px; }`],
})
export class ChatMarkdown {
  data = input.required<string>();
}

@Component({
  selector: 'pd-workflow-suggestion-card',
  standalone: true,
  template: `
    <div class="suggestion-card">
      <strong>{{ name() }}</strong>
      <p>{{ description() }}</p>
    </div>
  `,
  styles: [`
    .suggestion-card {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 12px;
      background: #f0fdf4;
    }
  `],
})
export class WorkflowSuggestionCard {
  name = input.required<string>();
  description = input.required<string>();
}

// --- Main chat panel ---

@Component({
  selector: 'pd-chat-panel',
  standalone: true,
  imports: [RenderMessageComponent],
  template: `
    <div class="pd-chat-panel">
      <div class="pd-chat-messages" #scrollContainer>
        @for (msg of chat.value(); track $index) {
          @switch (msg.role) {
            @case ('user') {
              <div class="pd-msg pd-msg--user">
                <div class="pd-bubble">{{ msg.content }}</div>
              </div>
            }
            @case ('assistant') {
              <div class="pd-msg pd-msg--assistant">
                @if (msg.content) {
                  <hb-render-message [message]="msg" />
                }
              </div>
            }
            @case ('error') {
              <div class="pd-msg pd-msg--error">
                {{ msg.content }}
                <button type="button" (click)="retryMessages()">Retry</button>
              </div>
            }
          }
        }
        @if (chat.isLoading()) {
          <div class="pd-msg pd-msg--assistant">
            <div class="pd-bubble pd-bubble--loading">Thinking...</div>
          </div>
        }
      </div>

      <div class="pd-chat-input-row">
        <textarea
          #inputEl
          class="pd-chat-input"
          placeholder="Describe a workflow... (e.g. 'When an order is created, send a Slack message')"
          rows="1"
          (keydown.enter)="onEnter($event, inputEl)"
        ></textarea>
        <button
          type="button"
          class="pd-btn pd-btn--primary"
          [disabled]="chat.isLoading()"
          (click)="onSend(inputEl)"
        >
          Send
        </button>
      </div>
    </div>
  `,
  styles: [`
    .pd-chat-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .pd-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pd-msg--user {
      align-self: flex-end;
      max-width: 80%;
    }
    .pd-msg--assistant {
      align-self: flex-start;
      max-width: 90%;
    }
    .pd-msg--error {
      color: #dc2626;
      padding: 8px;
      background: #fef2f2;
      border-radius: 6px;
    }
    .pd-bubble {
      padding: 8px 12px;
      border-radius: 12px;
      background: #f3f4f6;
      line-height: 1.4;
    }
    .pd-msg--user .pd-bubble {
      background: #3b82f6;
      color: white;
    }
    .pd-bubble--loading {
      color: #6b7280;
      font-style: italic;
    }
    .pd-chat-input-row {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
    }
    .pd-chat-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px 12px;
      resize: none;
      font: inherit;
    }
    .pd-btn--primary {
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      cursor: pointer;
    }
    .pd-btn--primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
})
export class ChatPanelComponent {
  private readonly mcpService = inject(PipedreamMcpService);
  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly scrollContainer = viewChild.required<ElementRef<HTMLDivElement>>('scrollContainer');

  constructor() {
    // Auto-scroll when messages change
    effect(() => {
      this.chat.value();
      requestAnimationFrame(() => {
        const el = this.scrollContainer().nativeElement;
        el.scrollTop = el.scrollHeight;
      });
    });
  }

  // Client-side tool: create a workflow from the AI's suggestion
  private readonly createWorkflowTool = createTool({
    name: 'create_workflow',
    description: 'Create a new workflow with the given name. Returns the workflow ID.',
    schema: s.object('CreateWorkflowInput', {
      name: s.string('The name of the workflow'),
    }),
    handler: (input) => {
      const workflow = this.workflowService.createWorkflow(input.name);
      return Promise.resolve({ workflowId: workflow.id });
    },
  });

  // Client-side tool: add a step to the active workflow
  private readonly addStepTool = createTool({
    name: 'add_workflow_step',
    description: 'Add a new action step to the specified workflow. Returns the step ID.',
    schema: s.object('AddStepInput', {
      workflowId: s.string('The workflow ID'),
    }),
    handler: (input) => {
      const step = this.workflowService.addStep(input.workflowId);
      return Promise.resolve({ stepId: step.id });
    },
  });

  // Client-side tool: list available custom triggers
  private readonly listCustomTriggersTool = createTool({
    name: 'list_custom_triggers',
    description: 'List custom triggers available in this application (non-Pipedream, internal event triggers).',
    handler: () => {
      return Promise.resolve(this.customTriggers);
    },
  });

  protected readonly allTools = computed(() => [
    ...this.mcpService.tools(),
    this.createWorkflowTool,
    this.addStepTool,
    this.listCustomTriggersTool,
  ]);

  chat = uiChatResource({
    model: 'claude-sonnet-4-20250514',
    debugName: 'workflow-chat',
    system: prompt`
      ### ROLE & TONE
      You are **Workflow Builder Assistant**, a concise AI that helps users
      build automated workflows using Pipedream integrations and custom triggers.

      ### WHAT YOU CAN DO
      - Search for Pipedream apps and components using the available MCP tools
      - Create workflows and add steps using the workflow tools
      - List the user's custom (internal) triggers

      ### RULES
      1. When the user describes a workflow, use tools to find the right apps/components first.
      2. Use create_workflow and add_workflow_step to actually build the workflow.
      3. Use list_custom_triggers to check available internal event triggers.
      4. Keep responses short and actionable.
      5. If you need clarification, ask a concise question.
      6. Show a summary of what you built using the workflow-suggestion-card component.

      ### EXAMPLES

      <user>Send a Slack message when an order is created</user>
      <assistant>
        <tool-call>list_custom_triggers</tool-call>
      </assistant>
      <assistant>
        <ui>
          <pd-chat-markdown data="I found an **Order Created** custom trigger and I can pair it with Slack. Let me set that up." />
          <pd-workflow-suggestion-card
            name="Order → Slack Notification"
            description="Triggers on Order Created, sends a Slack message to a channel of your choice."
          />
        </ui>
      </assistant>
    `,
    components: [
      exposeComponent(ChatMarkdown, {
        description: 'Show markdown text to the user',
        input: {
          data: s.streaming.string('The markdown content'),
        },
      }),
      exposeComponent(WorkflowSuggestionCard, {
        description: 'Show a workflow suggestion card summarizing a workflow that was created or proposed',
        input: {
          name: s.string('Workflow name'),
          description: s.streaming.string('Short description of what the workflow does'),
        },
      }),
    ],
    tools: this.allTools,
  });

  sendMessage(message: string) {
    this.chat.sendMessage({ role: 'user', content: message });
  }

  retryMessages() {
    this.chat.resendMessages();
  }

  protected onEnter(event: Event, textarea: HTMLTextAreaElement) {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) return; // allow Shift+Enter for newlines
    ke.preventDefault();
    this.onSend(textarea);
  }

  protected onSend(textarea: HTMLTextAreaElement) {
    const value = textarea.value.trim();
    if (!value || this.chat.isLoading()) return;
    this.sendMessage(value);
    textarea.value = '';
  }
}
```

---

## Step 6 — Configure `provideHashbrown` in myapp

Update `poc/apps/myapp/src/app/app.config.ts` to add hashbrown provider:

```typescript
import { provideHashbrown } from '@hashbrownai/angular';

// Add to providers array:
provideHashbrown({ baseUrl: 'http://localhost:3333/api/chat' }),
```

The `baseUrl` points to the Express API's `/api/chat` endpoint from Step 2.

---

## Step 7 — Wire chat panel into myapp

Update `poc/apps/myapp/src/app/app.ts` to add a collapsible chat panel and trigger MCP connection on startup:

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  WorkflowListComponent,
  WorkflowBuilderComponent,
  ChatPanelComponent,
  PipedreamMcpService,
} from '@poc/connect-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [WorkflowListComponent, WorkflowBuilderComponent, ChatPanelComponent],
  template: `
    <div class="app-layout">
      <aside class="app-sidebar">
        <h1 class="app-logo">Workflow Builder</h1>
        <pd-workflow-list (open)="onWorkflowOpen($event)" />
      </aside>

      <main class="app-main">
        <pd-workflow-builder />
      </main>

      @if (chatOpen()) {
        <aside class="app-chat">
          <pd-chat-panel />
        </aside>
      }

      <button class="chat-toggle" (click)="chatOpen.update(v => !v)">
        {{ chatOpen() ? '✕' : 'AI Chat' }}
      </button>
    </div>
  `,
  styles: [`
    .app-layout {
      display: flex;
      height: 100vh;
      font-family: system-ui, sans-serif;
    }
    .app-sidebar {
      width: 280px;
      border-right: 1px solid #e5e7eb;
      padding: 16px;
      overflow-y: auto;
      background: #f9fafb;
    }
    .app-logo {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 24px;
      color: #111827;
    }
    .app-main {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
    .app-chat {
      width: 400px;
      border-left: 1px solid #e5e7eb;
    }
    .chat-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 24px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 100;
    }
  `],
})
export class App implements OnInit {
  private readonly mcpService = inject(PipedreamMcpService);

  protected readonly chatOpen = signal(false);

  async ngOnInit() {
    try {
      await this.mcpService.connect();
    } catch (err) {
      console.warn('MCP connection failed (chat tools will be unavailable):', err);
    }
  }

  protected onWorkflowOpen(_id: string) {
    // WorkflowService already tracks the active workflow via setActiveWorkflow()
  }
}
```

---

## Step 8 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
export { PipedreamMcpService } from './lib/services/pipedream-mcp.service';
export { ChatPanelComponent } from './lib/components/chat-panel/chat-panel';
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/package.json` | Add `@hashbrownai/core`, `@hashbrownai/angular`, `@hashbrownai/anthropic`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `ngx-markdown`, `marked` |
| `poc/apps/api/src/main.ts` | Add `/api/chat` (hashbrown LLM proxy) and `/api/mcp` (MCP proxy) endpoints |
| `poc/apps/api/.env` | Add `ANTHROPIC_API_KEY` |
| `poc/libs/connect-angular/src/lib/services/pipedream-mcp.service.ts` | Create — MCP client service |
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` | Create — chat panel with `uiChatResource` |
| `poc/libs/connect-angular/src/index.ts` | Append exports |
| `poc/apps/myapp/src/app/app.config.ts` | Add `provideHashbrown()` |
| `poc/apps/myapp/src/app/app.ts` | Add chat panel toggle, MCP init |

---

## Notes

- **MCP URL format**: The proxy assumes `https://mcp.pipedream.com/{externalUserId}`. Read `https://mcp.pipedream.com/developers` first to verify the actual URL pattern and any required auth headers (API key, OAuth token, etc.). Adjust the proxy accordingly.
- **Model**: Uses `claude-sonnet-4-20250514` via `HashbrownAnthropic`. Change model string as needed.
- **Tool execution is client-side**: hashbrown sends tool call requests back to the Angular app, which executes them (MCP tools call the proxy, workflow tools call `WorkflowService` directly). The server only proxies the LLM stream.
- **No Material dependencies**: Unlike the hashbrown smart-home sample, this plan avoids `@angular/material` to stay consistent with the existing POC style. The chat UI uses plain HTML/CSS.
- **`ngx-markdown`**: Optional — only needed if you want the `ChatMarkdown` component to render actual markdown. For a simpler start, the `innerHTML` binding works for basic text. For production, use `ngx-markdown`'s `MarkdownComponent` or hashbrown's `exposeMarkdown` helper.
- **Streaming**: hashbrown handles streaming automatically. The server writes binary frames (`application/octet-stream`), the client decodes them via the built-in HTTP transport. No SSE or WebSocket setup needed.
