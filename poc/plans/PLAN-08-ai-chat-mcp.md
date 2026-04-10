# PLAN-08 — Phase 2: AI Chat via Pipedream MCP

## Goal

Add an AI chat panel to the workflow builder. The user describes what they want in natural language ("notify Slack when an order is created") and the AI assembles the workflow steps automatically, using Pipedream's MCP server to browse apps and components.

## Context

- Pipedream MCP server: `https://mcp.pipedream.com/developers`
- MCP (Model Context Protocol) exposes Pipedream's catalog as AI tools — the AI can search apps, list actions, and understand component props
- The AI backend (Claude via Anthropic API) runs server-side in `poc/apps/api/` — MCP keys must never reach the browser
- On the frontend, the chat is a thin Angular component that sends messages to your API and receives structured workflow suggestions
- PLAN-07 must be complete (full manual workflow builder working)

## Prerequisites

PLAN-01 through PLAN-07 must be completed. The manual workflow builder must be working end-to-end.

---

## Architecture

```
Angular Chat UI
     │
     │  POST /api/chat  { messages: [...], workflowContext: {...} }
     ▼
Express API (poc/apps/api/)
     │
     ├── Anthropic SDK (claude-sonnet-4-x)
     │   └── system prompt with workflow builder instructions
     │
     └── Pipedream MCP tools (via @anthropic-ai/mcp-server-sdk or HTTP)
         └── https://mcp.pipedream.com/developers
              ├── search_apps(query)
              ├── list_actions(app)
              ├── list_triggers(app)
              ├── get_component(key)
              └── ... (see MCP server docs)
```

The AI returns either:
- A plain text response (for clarifying questions)
- A structured `WorkflowSuggestion` JSON object (when it has enough info to build the workflow)

---

## Step 1 — Read Pipedream MCP documentation

Before implementing, fetch and read the MCP server docs:

```
https://mcp.pipedream.com/developers
```

Key things to find:
1. What tools are exposed (names, input schemas, output schemas)
2. Authentication requirements (API key? OAuth?)
3. Whether it's an SSE-based MCP server or HTTP tools
4. Rate limits

---

## Step 2 — Install dependencies in API

```bash
# From poc/
npm install @anthropic-ai/sdk
```

If Pipedream MCP requires a dedicated client package, install it too (check docs from Step 1).

---

## Step 3 — Add `/api/chat` endpoint to Express

Add to `poc/apps/api/src/main.ts` (or a separate router file `poc/apps/api/src/routes/chat.ts`):

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// TODO: Replace with actual MCP tool definitions from https://mcp.pipedream.com/developers
// Each tool should map to an MCP server capability
const pipedreamMcpTools: Anthropic.Tool[] = [
  {
    name: 'search_apps',
    description: 'Search Pipedream apps by name or category',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_actions',
    description: 'List available actions for a Pipedream app',
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name slug, e.g. "slack"' },
      },
      required: ['app'],
    },
  },
  {
    name: 'list_triggers',
    description: 'List available triggers for a Pipedream app',
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name slug' },
      },
      required: ['app'],
    },
  },
  {
    name: 'get_component',
    description: 'Get detailed information about a specific component including its configurable props',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Component key, e.g. "slack_v2-send-message-to-channel"' },
      },
      required: ['key'],
    },
  },
];

async function callMcpTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  // TODO: implement actual MCP tool calls based on the server documentation
  // This will either be HTTP calls to https://mcp.pipedream.com or
  // using an MCP client SDK if one is available
  throw new Error(`MCP tool ${name} not yet implemented`);
}

const SYSTEM_PROMPT = `
You are a workflow automation assistant. You help users build automated workflows using Pipedream integrations and custom internal triggers.

A workflow consists of:
1. A trigger (first step) — either a custom internal event (like "Order Created") or a Pipedream app trigger
2. One or more actions — Pipedream app actions (send Slack message, create calendar event, etc.)

When the user describes a workflow, use the available tools to:
1. Find the right apps and components
2. Return a structured WorkflowSuggestion

Custom triggers available in this app:
{{CUSTOM_TRIGGERS}}

When you have enough information to suggest a workflow, respond with a JSON object in this exact format:
\`\`\`json
{
  "type": "workflow_suggestion",
  "name": "Human readable workflow name",
  "steps": [
    {
      "type": "trigger",
      "source": "custom",
      "customTriggerId": "order.created"
    },
    {
      "type": "action",
      "source": "pipedream",
      "appSlug": "slack",
      "componentKey": "slack_v2-send-message-to-channel",
      "suggestedConfig": {
        "channel": "#orders",
        "text": "New order {{orderId}} received!"
      }
    }
  ]
}
\`\`\`

If you need clarification, ask a concise question. Keep responses short and focused.
`;

app.post('/api/chat', async (req, res) => {
  const { messages, customTriggers = [] } = req.body;

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  const systemPrompt = SYSTEM_PROMPT.replace(
    '{{CUSTOM_TRIGGERS}}',
    JSON.stringify(customTriggers, null, 2)
  );

  try {
    // Agentic loop — handle tool calls
    let currentMessages = [...messages];
    let finalResponse: string | null = null;

    while (true) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        tools: pipedreamMcpTools,
        messages: currentMessages,
      });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        finalResponse = textBlock?.type === 'text' ? textBlock.text : '';
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: await Promise.all(
            response.content
              .filter((b) => b.type === 'tool_use')
              .map(async (b) => {
                if (b.type !== 'tool_use') return null!;
                let result: unknown;
                try {
                  result = await callMcpTool(b.name, b.input as Record<string, unknown>);
                } catch (e) {
                  result = { error: String(e) };
                }
                return {
                  type: 'tool_result' as const,
                  tool_use_id: b.id,
                  content: JSON.stringify(result),
                };
              })
          ),
        };

        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          toolResults,
        ];
      } else {
        break;
      }
    }

    res.json({ response: finalResponse });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat request failed' });
  }
});
```

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Step 4 — Angular `ChatPanelComponent`

Create `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts`:

```typescript
import { Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import { PIPEDREAM_CONFIG } from '../../tokens/pipedream-config.token';
import { PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface WorkflowSuggestion {
  type: 'workflow_suggestion';
  name: string;
  steps: Array<{
    type: 'trigger' | 'action';
    source: 'custom' | 'pipedream';
    customTriggerId?: string;
    appSlug?: string;
    componentKey?: string;
    suggestedConfig?: Record<string, unknown>;
  }>;
}

@Component({
  selector: 'pd-chat-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanelComponent {
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly input = signal('');
  protected readonly loading = signal(false);
  protected readonly suggestion = signal<WorkflowSuggestion | null>(null);

  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly config = inject(PIPEDREAM_CONFIG);

  private get apiBase(): string {
    // Derive API base from token endpoint URL (strip /api/pipedream/token)
    return this.config.tokenEndpointUrl.replace('/api/pipedream/token', '');
  }

  protected async send() {
    const userInput = this.input().trim();
    if (!userInput || this.loading()) return;

    const userMessage: ChatMessage = { role: 'user', content: userInput };
    this.messages.update((msgs) => [...msgs, userMessage]);
    this.input.set('');
    this.loading.set(true);
    this.suggestion.set(null);

    try {
      const response = await fetch(`${this.apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.messages(),
          customTriggers: this.customTriggers,
        }),
      });

      const data = await response.json();
      const assistantText: string = data.response ?? '';

      this.messages.update((msgs) => [
        ...msgs,
        { role: 'assistant', content: assistantText },
      ]);

      // Try to parse a WorkflowSuggestion from the response
      const jsonMatch = assistantText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.type === 'workflow_suggestion') {
            this.suggestion.set(parsed);
          }
        } catch {
          // Not valid JSON — plain text response
        }
      }
    } catch {
      this.messages.update((msgs) => [
        ...msgs,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      this.loading.set(false);
    }
  }

  protected applySuggestion() {
    const s = this.suggestion();
    if (!s) return;

    const workflow = this.workflowService.createWorkflow(s.name);

    // The workflow was created with one empty trigger step — configure each step from suggestion
    s.steps.forEach((suggestedStep, index) => {
      if (index === 0) {
        // Configure the trigger step that was auto-created
        if (suggestedStep.source === 'custom' && suggestedStep.customTriggerId) {
          const data: CustomTriggerStep = {
            source: 'custom',
            customTriggerId: suggestedStep.customTriggerId,
          };
          this.workflowService.configureStep(workflow.id, workflow.steps[0].id, data);
        }
        // Pipedream trigger: addStep then configure (needs app+component lookup — omit for now)
      } else {
        // Add and configure action steps
        const newStep = this.workflowService.addStep(workflow.id);
        if (suggestedStep.source === 'custom' && suggestedStep.customTriggerId) {
          const data: CustomTriggerStep = {
            source: 'custom',
            customTriggerId: suggestedStep.customTriggerId,
          };
          this.workflowService.configureStep(workflow.id, newStep.id, data);
        }
        // Note: Pipedream steps need app+component objects fetched from SDK before applying.
        // For a complete implementation, fetch the app and component here and then call
        // configureStep with a PipedreamStep. The suggestedConfig becomes configuredProps.
      }
    });

    this.suggestion.set(null);
  }
}
```

### `chat-panel.html`

```html
<div class="pd-chat-panel">
  <div class="pd-chat-messages" #scrollContainer>
    @for (msg of messages(); track $index) {
      <div class="pd-chat-message pd-chat-message--{{ msg.role }}">
        <div class="pd-chat-bubble">{{ msg.content }}</div>
      </div>
    }
    @if (loading()) {
      <div class="pd-chat-message pd-chat-message--assistant">
        <div class="pd-chat-bubble pd-chat-bubble--loading">Thinking...</div>
      </div>
    }
  </div>

  @if (suggestion()) {
    <div class="pd-suggestion-banner">
      <p>I've drafted a workflow: <strong>{{ suggestion()!.name }}</strong></p>
      <button type="button" class="pd-btn pd-btn--primary" (click)="applySuggestion()">
        Apply to Builder
      </button>
    </div>
  }

  <form class="pd-chat-input-row" (ngSubmit)="send()">
    <input
      type="text"
      class="pd-chat-input"
      placeholder="Describe a workflow... (e.g. 'When an order is created, send a Slack message')"
      [ngModel]="input()"
      (ngModelChange)="input.set($event)"
      name="chat-input"
      [disabled]="loading()"
      autocomplete="off"
    />
    <button
      type="submit"
      class="pd-btn pd-btn--primary"
      [disabled]="loading() || !input().trim()"
    >
      Send
    </button>
  </form>
</div>
```

---

## Step 5 — Add chat panel to myapp

In `AppComponent` (PLAN-07), add the chat toggle:

```typescript
import { ChatPanelComponent } from '@poc/connect-angular';

// In template:
// Add a toggle button in the header and conditionally show <pd-chat-panel>
```

The simplest integration: add a collapsible chat panel at the bottom of `.app-main`, toggled by a button.

---

## Step 6 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
export { ChatPanelComponent } from './lib/components/chat-panel/chat-panel';
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/apps/api/src/main.ts` | Add `/api/chat` endpoint |
| `poc/apps/api/.env` | Add `ANTHROPIC_API_KEY` |
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.html` | Create |
| `poc/libs/connect-angular/src/lib/components/chat-panel/chat-panel.css` | Create |
| `poc/libs/connect-angular/src/index.ts` | Append export |
| `poc/apps/myapp/src/app/app.ts` | Add chat panel toggle |
| `poc/package.json` | Added `@anthropic-ai/sdk` |

---

## Notes

- The `callMcpTool()` implementation is the critical missing piece — it depends on what Pipedream's MCP server exposes. Read `https://mcp.pipedream.com/developers` first and implement accordingly
- The `applySuggestion()` method handles custom trigger steps fully but only sketches Pipedream steps (it needs app+component objects, which require SDK calls). Complete it by injecting `PipedreamClientService` and fetching the app/component by `appSlug` and `componentKey` before calling `configureStep`
- The AI can suggest prop values (`suggestedConfig`) but these are strings that reference trigger payload fields (e.g. `{{orderId}}`). Rendering these as literal values in `configuredProps` will work for the demo; a full implementation would use a template variable system
- Consider rate-limiting `/api/chat` — Claude API calls are not free
