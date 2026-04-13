import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  exposeComponent,
  RenderMessageComponent,
  uiChatResource,
  createTool,
} from '@hashbrownai/angular';
import { prompt, s } from '@hashbrownai/core';
import { PipedreamMcpService } from '../../services/pipedream-mcp.service';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';

// ── Exposed components the AI can render ────────────────────────────────────

@Component({
  selector: 'pd-chat-markdown',
  standalone: true,
  template: `<div class="pd-chat-md" [innerHTML]="data()"></div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .pd-chat-md p {
        margin: 0 0 8px;
      }
    `,
  ],
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
  styles: [
    `
      .suggestion-card {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 12px;
        background: #f0fdf4;
      }
      .suggestion-card p {
        margin: 4px 0 0;
        color: #374151;
        font-size: 0.875rem;
      }
    `,
  ],
})
export class WorkflowSuggestionCard {
  name = input.required<string>();
  description = input.required<string>();
}

// ── Main chat panel ─────────────────────────────────────────────────────────

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
          placeholder="Describe a workflow..."
          rows="1"
          (keydown.enter)="onEnter($event, inputEl)"
        ></textarea>
        <button
          type="button"
          class="pd-btn pd-btn--send"
          [disabled]="chat.isLoading()"
          (click)="onSend(inputEl)"
        >
          Send
        </button>
      </div>
    </div>
  `,
  styleUrl: './chat-panel.css',
})
export class ChatPanelComponent {
  private readonly mcpService = inject(PipedreamMcpService);
  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly scrollContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('scrollContainer');

  constructor() {
    effect(() => {
      this.chat.value();
      requestAnimationFrame(() => {
        const el = this.scrollContainer().nativeElement;
        el.scrollTop = el.scrollHeight;
      });
    });
  }

  // ── Client-side tools ───────────────────────────────────────────────────

  private readonly createWorkflowTool = createTool({
    name: 'create_workflow',
    description:
      'Create a new workflow with the given name. Returns the workflow ID.',
    schema: s.object('CreateWorkflowInput', {
      name: s.string('The name of the workflow'),
    }),
    handler: (input) => {
      const workflow = this.workflowService.createWorkflow(input.name);
      return Promise.resolve({ workflowId: workflow.id });
    },
  });

  private readonly addStepTool = createTool({
    name: 'add_workflow_step',
    description:
      'Add a new action step to the specified workflow. Returns the step ID.',
    schema: s.object('AddStepInput', {
      workflowId: s.string('The workflow ID'),
    }),
    handler: (input) => {
      const step = this.workflowService.addStep(input.workflowId);
      return Promise.resolve({ stepId: step.id });
    },
  });

  private readonly listCustomTriggersTool = createTool({
    name: 'list_custom_triggers',
    description:
      'List custom triggers available in this application (non-Pipedream, internal event triggers).',
    handler: () => {
      return Promise.resolve(this.customTriggers);
    },
  });

  // ── Chat resource ───────────────────────────────────────────────────────

  chat = uiChatResource({
    model: 'gpt-4o@2025-01-01-preview',
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
        description:
          'Show a workflow suggestion card summarizing a workflow that was created or proposed',
        input: {
          name: s.string('Workflow name'),
          description: s.streaming.string(
            'Short description of what the workflow does',
          ),
        },
      }),
    ],
    tools: [
      ...this.mcpService.tools(),
      this.createWorkflowTool,
      this.addStepTool,
      this.listCustomTriggersTool,
    ],
  });

  sendMessage(message: string) {
    this.chat.sendMessage({ role: 'user', content: message });
  }

  retryMessages() {
    this.chat.resendMessages();
  }

  protected onEnter(event: Event, textarea: HTMLTextAreaElement) {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) return;
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
