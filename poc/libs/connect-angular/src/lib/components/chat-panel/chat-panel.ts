import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  runInInjectionContext,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import {
  exposeComponent,
  RenderMessageComponent,
  uiChatResource,
  createTool,
  type UiChatResourceRef,
} from '@hashbrownai/angular';
import { type Chat, prompt, s } from '@hashbrownai/core';
import { PipedreamMcpService } from '../../services/pipedream-mcp.service';
import { PipedreamClientService } from '../../services/pipedream-client.service';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import type { PipedreamStep } from '../../models/workflow.model';

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
        @for (msg of chat().value(); track $index) {
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
        @if (chat().isLoading()) {
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
          [disabled]="chat().isLoading()"
          (click)="onSend(inputEl)"
        >
          Send
        </button>
      </div>
    </div>
  `,
  styleUrl: './chat-panel.css',
})
export class ChatPanelComponent implements AfterViewInit {
  private readonly injector = inject(Injector);
  private readonly mcpService = inject(PipedreamMcpService);
  private readonly pdClient = inject(PipedreamClientService);
  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly scrollContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('scrollContainer');

  private readonly textarea =
    viewChild<ElementRef<HTMLTextAreaElement>>('inputEl');

  // Chat is a writable signal so we can recreate it when MCP tools change.
  // Pipedream MCP dynamically adds/removes tools based on conversation state
  // (e.g. WHAT_ARE_YOU_TRYING_TO_DO → SELECT_APPS → begin_configuration_*),
  // so the chat resource must be recreated to pick up new tools.
  readonly chat: WritableSignal<UiChatResourceRef<any>>;

  private pendingToolRefresh = false;

  constructor() {
    // Initialize the chat (runs in constructor = injection context is available)
    this.chat = signal(this.initChat());

    // Auto-scroll when messages change
    effect(() => {
      this.chat().value();
      requestAnimationFrame(() => {
        const el = this.scrollContainer().nativeElement;
        el.scrollTop = el.scrollHeight;
      });
    });

    // Watch for MCP tool changes — reset chat with updated tools.
    // Skip the first emission (initial tool load is already captured by initChat).
    let firstSkipped = false;
    effect(() => {
      this.mcpService.tools();
      if (!firstSkipped) {
        firstSkipped = true;
        return;
      }
      untracked(() => {
        if (this.chat().isLoading()) {
          // Can't reset mid-generation — defer until the loop finishes.
          this.pendingToolRefresh = true;
        } else {
          this.resetChat({ messages: this.chat().value() });
        }
      });
    });

    // When loading finishes with a pending tool refresh, apply it.
    effect(() => {
      const loading = this.chat().isLoading();
      if (!loading && this.pendingToolRefresh) {
        untracked(() => {
          this.pendingToolRefresh = false;
          this.resetChat({
            messages: this.chat().value(),
            resend: true,
          });
        });
      }
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

  private readonly configureStepTool = createTool({
    name: 'configure_step',
    description:
      'Configure a workflow step (trigger or action) with a Pipedream app and component. ' +
      'Works for BOTH trigger steps and action steps. Provide the app slug and component key. ' +
      'For triggers, use trigger-type components (e.g. "schedule-custom-interval" for schedules). ' +
      'For actions, use action-type components (e.g. "slack_v2-send-message").',
    schema: s.object('ConfigureStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to configure'),
      appSlug: s.string(
        'The Pipedream app name_slug (e.g. "github", "slack_v2", "schedule")',
      ),
      componentKey: s.string(
        'The Pipedream component key (e.g. "github-list-repos", "schedule-custom-interval")',
      ),
    }),
    handler: async (input) => {
      const [appResponse, componentResponse] = await Promise.all([
        this.pdClient.getApp(input.appSlug),
        this.pdClient.getComponent(input.componentKey),
      ]);
      const app = (appResponse as any).data;
      const component = (componentResponse as any).data;
      const data: PipedreamStep = {
        source: 'pipedream',
        app,
        component,
        configuredProps: {},
      };
      this.workflowService.configureStep(input.workflowId, input.stepId, data);

      // Detect auth requirements from configurableProps
      const props = component.configurableProps ?? [];
      const authApps = props
        .filter((p: any) => p.type === 'app')
        .map((p: any) => p.app as string);
      const requiredProps = props
        .filter((p: any) => p.type !== 'app' && !p.optional)
        .map((p: any) => ({ name: p.name, label: p.label ?? p.name, type: p.type }));

      return {
        success: true,
        app: app.name,
        component: component.name,
        componentType: component.componentType ?? 'action',
        requiresAccountConnection: authApps.length > 0,
        accountsToConnect: authApps,
        requiredProperties: requiredProps,
      };
    },
  });

  private readonly listComponentsTool = createTool({
    name: 'list_app_components',
    description:
      'List available Pipedream components (actions or triggers) for a given app. ' +
      'Use this to discover the correct component keys BEFORE calling configure_step. ' +
      'Returns component name, key, and type for each match.',
    schema: s.object('ListComponentsInput', {
      appSlug: s.string('The Pipedream app name_slug (e.g. "google_calendar", "slack_v2", "schedule")'),
      componentType: s.string('Filter by type: "action" or "trigger". Pass empty string to list all.'),
    }),
    handler: async (input) => {
      const type = input.componentType === 'action' || input.componentType === 'trigger'
        ? input.componentType
        : undefined;
      const response = await this.pdClient.listComponents({
        app: input.appSlug,
        componentType: type,
        limit: 30,
      });
      const components = ((response as any).data ?? []).map((c: any) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        type: c.componentType,
      }));
      return { app: input.appSlug, components };
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

  private readonly getActiveWorkflowTool = createTool({
    name: 'get_active_workflow',
    description:
      'Get the currently active workflow, including its ID, name, and all steps ' +
      'with their configuration. Returns null if no workflow is active. ' +
      'ALWAYS call this first when the user asks about their current workflow ' +
      'or wants to modify an existing one.',
    handler: () => {
      const workflow = this.workflowService.activeWorkflow();
      if (!workflow) return Promise.resolve({ activeWorkflow: null as any });
      return Promise.resolve({
        activeWorkflow: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          steps: workflow.steps.map((step) => ({
            id: step.id,
            type: step.type,
            configured: !!step.data,
            app: step.data?.source === 'pipedream' ? (step.data as PipedreamStep).app?.name : null,
            component: step.data?.source === 'pipedream' ? (step.data as PipedreamStep).component?.name : null,
            componentKey: step.data?.source === 'pipedream' ? (step.data as PipedreamStep).component?.key : null,
            customTriggerId: step.data?.source === 'custom' ? step.data.customTriggerId : null,
          })),
        },
      });
    },
  });

  private readonly updateWorkflowNameTool = createTool({
    name: 'update_workflow_name',
    description:
      'Rename an existing workflow. Use this after building a workflow to give it a descriptive name.',
    schema: s.object('UpdateWorkflowNameInput', {
      workflowId: s.string('The workflow ID'),
      name: s.string('The new name for the workflow'),
    }),
    handler: (input) => {
      this.workflowService.updateWorkflow(input.workflowId, { name: input.name });
      return Promise.resolve({ success: true, name: input.name });
    },
  });

  private readonly removeStepTool = createTool({
    name: 'remove_workflow_step',
    description:
      'Remove a step from a workflow by its step ID. Cannot remove the trigger step (index 0).',
    schema: s.object('RemoveStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to remove'),
    }),
    handler: (input) => {
      this.workflowService.removeStep(input.workflowId, input.stepId);
      return Promise.resolve({ success: true });
    },
  });

  private readonly clientTools = [
    this.getActiveWorkflowTool,
    this.createWorkflowTool,
    this.addStepTool,
    this.listComponentsTool,
    this.configureStepTool,
    this.removeStepTool,
    this.updateWorkflowNameTool,
    this.listCustomTriggersTool,
  ];

  // ── Chat lifecycle ──────────────────────────────────────────────────────

  private initChat(messages?: Chat.Message<any, any>[]): UiChatResourceRef<any> {
    return runInInjectionContext(this.injector, () => {
      return uiChatResource({
        model: 'gpt-4o@2025-01-01-preview',
        debugName: 'workflow-chat',
        messages,
        system: prompt`
          ### ROLE
          You are **Workflow Builder Assistant**, a concise AI that helps users
          build automated workflows using Pipedream integrations and custom triggers.
          You run tasks that access and connect to web apps on behalf of the user.

          ### PIPEDREAM MCP TOOLS
          You have access to tools provided by the Pipedream MCP server for
          integrating with 2,500+ external apps and services.

          <tool_discovery>
            If available, use the WHAT_ARE_YOU_TRYING_TO_DO tool to find relevant tools.
            After calling it, you will have a SELECT_APPS tool — call it right away
            to find the right integration.
            After SELECT_APPS, you will get integration-specific tools.
          </tool_discovery>

          <tool_configuration_workflow>
            Tools beginning with begin_configuration_* start a configuration session.
            After calling one:
            1. configure_component — fetch available options for properties that need them
            2. abort_configuration_* — cancel if something goes wrong
            3. run_* — execute the action once configuration is complete

            Check if the tool has required properties:
            - If it has properties to configure, use configure_component to fetch options
            - If it has NO required properties (empty inputSchema), immediately call run_*

            IMPORTANT: Do NOT invent tool names like configure_<toolname>_props.
            Only use the exact tool names provided in the available tools list.
          </tool_configuration_workflow>

          <async_options>
            If a tool named ASYNC_OPTIONS_* is available, ALWAYS use it to fetch
            valid options for the property you are about to configure. Skipping this
            will result in passing invalid data and the tool will fail.
          </async_options>

          <authentication>
            If authentication is required, you will get a message about it when the
            tool is called. Do not discuss authentication with the user unless a tool
            call response says it is needed.
          </authentication>

          ### WORKFLOW TOOLS (LOCAL)
          You have client-side tools for building and managing workflows:
          - get_active_workflow: Get the currently open workflow with all its steps
          - create_workflow: Create a new workflow with a name
          - add_workflow_step: Add a step to a workflow
          - list_app_components: List available components for an app (discover correct keys)
          - configure_step: Configure a step (trigger OR action) with a Pipedream app and component
          - remove_workflow_step: Remove a step from a workflow
          - update_workflow_name: Rename a workflow
          - list_custom_triggers: List internal event triggers available in this app

          <existing_workflow_handling>
            ALWAYS call get_active_workflow first when the user starts a conversation.
            - If there IS an active workflow with configured steps, briefly describe
              what it does and ask the user whether they want to modify it or
              create a new one.
            - If the active workflow is empty (only an unconfigured trigger), use it
              directly — no need to ask.
            - If there is NO active workflow, create one with create_workflow.
          </existing_workflow_handling>

          <trigger_configuration>
            The trigger (step index 0) defines what starts the workflow.
            - If the user's request clearly implies a trigger (e.g. "on schedule",
              "when an order is created", "every Monday"), configure it using
              configure_step with the appropriate component.
            - For schedule-based: appSlug "schedule", componentKey
              "schedule-custom-interval" or similar.
            - For internal events: check list_custom_triggers for a match.
            - For app-event triggers: search via MCP tools.
            - If the trigger is unclear or the user hasn't decided, ask briefly
              what should start the workflow. It's OK to leave it unconfigured
              if the user is still figuring it out.
          </trigger_configuration>

          <account_connection_requirements>
            When configure_step returns requiresAccountConnection: true, it means the
            user must connect their account (OAuth) for that app before the step can
            run. ALWAYS tell the user which accounts they need to connect. Example:
            "You'll need to connect your Google Calendar and Slack accounts in the
            step settings before running this workflow."
            List ALL steps that need account connections at the end of the summary.
          </account_connection_requirements>

          <component_key_discovery>
            NEVER guess or invent component keys for configure_step. Component
            keys must come from one of these sources:
            - list_app_components — the PRIMARY way to discover keys. Call it
              with the app slug and optionally a componentType filter to get the
              exact keys available for that app.
            - A previous successful configure_step result.
            - The get_active_workflow result (componentKey field).
            ALWAYS call list_app_components before configure_step for a new step.
          </component_key_discovery>

          <error_handling>
            If configure_step fails (e.g. 404 component not found):
            - Do NOT create a new step. The existing step is still there and empty.
            - Retry configure_step on the SAME step with a corrected component key.
            - Use MCP tool discovery to find the correct key if you guessed wrong.
            - If after discovery you still can't find the component, tell the user
              and ask what they'd like to use instead.
          </error_handling>

          When building or modifying a workflow:
          1. Use list_app_components to discover correct component keys before configuring.
          2. Use create_workflow only if you need a new workflow.
          3. Configure the trigger step if the user's intent is clear.
          4. Use add_workflow_step + configure_step for each action step.
          5. Always configure every action step — unconfigured steps are useless.
          6. Use remove_workflow_step to remove steps the user no longer wants.
          7. Use update_workflow_name to give the workflow a descriptive name.
          8. Check list_custom_triggers for available internal event triggers.
          9. After building, list any steps that require account connections.
          10. Show a summary using the workflow-suggestion-card component.

          ### STYLE
          - Be brief. Limit responses to a few sentences.
          - Use informal, clear language with contractions.
          - Never use filler phrases ("To achieve this", "Let's get started").
          - Never reference tool names to the user — describe what you're doing instead.
          - If you need clarification, ask a concise question.
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
          ...this.clientTools,
        ],
      });
    });
  }

  private resetChat(options?: {
    messages?: Chat.Message<any, any>[];
    resend?: boolean;
  }) {
    const current = this.chat();
    if (current) this.stopChat(current);
    this.chat.set(this.initChat(options?.messages));
    if (options?.resend) {
      this.chat().resendMessages();
    }
  }

  private async stopChat(chat: UiChatResourceRef<any>) {
    // Retry stop() — hashbrown may throw if it's mid-generation
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        chat.stop();
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 50));
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  ngAfterViewInit() {
    this.mcpService.connect();
    this.textarea()!.nativeElement.value = `I need a workflow that on schedule fetches my google calendar events for the current week, summarizes all of them and sends a short report as a slack message`;
  }

  sendMessage(message: string) {
    this.chat().sendMessage({ role: 'user', content: message });
  }

  retryMessages() {
    this.chat().resendMessages();
  }

  protected onEnter(event: Event, textarea: HTMLTextAreaElement) {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) return;
    ke.preventDefault();
    this.onSend(textarea);
  }

  protected onSend(textarea: HTMLTextAreaElement) {
    const value = textarea.value.trim();
    if (!value || this.chat().isLoading()) return;
    this.sendMessage(value);
    textarea.value = '';
  }
}
