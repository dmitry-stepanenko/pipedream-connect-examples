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
import type { PipedreamStep, StepOutputSchema } from '../../models/workflow.model';
import { getTriggerSchema, KNOWN_TRIGGER_SCHEMAS } from '../../models/trigger-schemas';

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

  // ── Client-side workflow tools ──────────────────────────────────────────

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

      // Auto-set output schema for known trigger types
      const triggerSchema = getTriggerSchema(input.componentKey);
      if (triggerSchema) {
        // Convert paths to a flat StepOutputSchema for storage
        const flatSchema: StepOutputSchema = {};
        for (const [path, type] of Object.entries(triggerSchema.paths)) {
          flatSchema[path] = type as StepOutputSchema[string];
        }
        this.workflowService.setStepOutputSchema(input.workflowId, input.stepId, flatSchema);
      }

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
        triggerEventSchema: triggerSchema
          ? {
              name: triggerSchema.name,
              exampleReferences: triggerSchema.exampleReferences,
            }
          : null,
        allProperties: props
          .filter((p: any) => p.type !== 'app')
          .map((p: any) => ({
            name: p.name,
            label: p.label ?? p.name,
            type: p.type,
            description: p.description ?? '',
            optional: !!p.optional,
            default: p.default,
            options: p.options ?? null,
            remoteOptions: !!p.remoteOptions,
          })),
      };
    },
  });

  private readonly setStepPropsTool = createTool({
    name: 'set_step_props',
    description:
      'Set property values on an already-configured workflow step. Call this AFTER ' +
      'configure_step to fill in the step\'s required and optional properties. ' +
      'Pass a JSON string in propsJson where keys are property names (from configure_step\'s ' +
      'allProperties response) and values are the desired settings. ' +
      'Example propsJson: \'{"text": "Hello world", "channelType": "Public Channel", "conversation": "#general"}\'. ' +
      'You can call this multiple times to update props incrementally.',
    schema: s.object('SetStepPropsInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to set properties on'),
      propsJson: s.string(
        'A JSON string of property key-value pairs. Keys are property names from configure_step\'s allProperties. ' +
        'Values must match the property types (string, integer, boolean, etc.).',
      ),
    }),
    handler: (input): Promise<{ success: boolean; error: string | null; configuredProps: Record<string, unknown> | null }> => {
      let props: Record<string, unknown>;
      try {
        props = JSON.parse(input.propsJson);
      } catch {
        return Promise.resolve({ success: false, error: 'Invalid JSON in propsJson', configuredProps: null });
      }
      const workflow = this.workflowService.workflows().find((w) => w.id === input.workflowId);
      if (!workflow) return Promise.resolve({ success: false, error: 'Workflow not found', configuredProps: null });
      const step = workflow.steps.find((st) => st.id === input.stepId);
      if (!step?.data || step.data.source !== 'pipedream') {
        return Promise.resolve({ success: false, error: 'Step not configured yet — call configure_step first', configuredProps: null });
      }
      const current = step.data as PipedreamStep;
      const merged = { ...current.configuredProps, ...props };
      this.workflowService.configureStep(input.workflowId, input.stepId, {
        ...current,
        configuredProps: merged,
      });
      return Promise.resolve({ success: true, error: null, configuredProps: merged });
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
            tested: step.tested ?? false,
            outputSchema: step.outputSchema ?? null,
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

  private readonly testStepTool = createTool({
    name: 'test_step',
    description:
      'Test a configured workflow step to discover its output schema. ' +
      'The step can only be tested if it has been configured (configure_step + set_step_props). ' +
      'Some steps may also require manual setup by the user (e.g. connecting an account) before testing will succeed. ' +
      'After a successful test, the output schema is stored on the step and you can reference its data ' +
      'in downstream steps via {{steps.STEP_NAME.$return_value.field}}.',
    schema: s.object('TestStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to test'),
    }),
    handler: async (input) => {
      return this.workflowService.testStep(input.workflowId, input.stepId);
    },
  });

  /** Build a prompt fragment documenting known trigger event schemas. */
  private buildTriggerSchemaPrompt(): string {
    return KNOWN_TRIGGER_SCHEMAS.map((schema) => {
      const pathList = Object.entries(schema.paths)
        .map(([path, type]) => `  - steps.trigger.event.${path} (${type})`)
        .join('\n');
      const examples = schema.exampleReferences
        .map((ref) => `  - ${ref}`)
        .join('\n');
      return `
              <trigger type="${schema.name}" components="${schema.componentKeys.join(', ')}">
                Available paths:
${pathList}
                Example references:
${examples}
              </trigger>`;
    }).join('\n');
  }

  private readonly clientTools = [
    this.getActiveWorkflowTool,
    this.createWorkflowTool,
    this.addStepTool,
    this.listComponentsTool,
    this.configureStepTool,
    this.setStepPropsTool,
    this.testStepTool,
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
          <role>
            You are Workflow Builder Assistant, an expert at assembling automated
            workflows using Pipedream integrations and custom triggers. You help
            users design multi-step workflows by configuring triggers and actions
            from 2,500+ apps.

            You are powered by Pipedream Connect with managed authentication.
            Credentials are encrypted and isolated, with no direct exposure to
            AI models.
          </role>

          <todays_date>${new Date().toISOString()}</todays_date>

          <tools>
            You have two sets of tools:

            <workflow_tools>
              Client-side tools for building and managing workflows:
              - get_active_workflow — get the current workflow with all its steps and output schemas
              - create_workflow — create a new workflow with a name
              - add_workflow_step — add a step to a workflow
              - list_app_components — discover correct component keys for an app
              - configure_step — configure a step with a Pipedream app and component
              - set_step_props — set property values on a configured step
              - test_step — execute a step to discover its output schema (REQUIRED before referencing outputs)
              - remove_workflow_step — remove a step from a workflow
              - update_workflow_name — rename a workflow
              - list_custom_triggers — list internal event triggers
            </workflow_tools>

            <mcp_tools>
              Pipedream MCP server tools for discovering apps and integrations.

              If available, use WHAT_ARE_YOU_TRYING_TO_DO to find relevant tools.
              After calling it, call SELECT_APPS right away to discover which
              integration tools are available.

              <tool_configuration_workflow>
                Tools beginning with begin_configuration_* start a config session:
                1. configure_component — fetch options for properties that need them
                2. abort_configuration_* — cancel if something goes wrong
                3. run_* — execute once configuration is complete

                If it has NO required properties (empty inputSchema), call run_*
                immediately. Do NOT invent tool names — only use exact names from
                the available tools list.
              </tool_configuration_workflow>

              If a tool named ASYNC_OPTIONS_* is available, ALWAYS use it to fetch
              valid options before configuring a property. Skipping this causes
              invalid data.

              If authentication is required, you'll get a message about it when
              the tool is called. Don't discuss auth unless a tool response says
              it's needed.
            </mcp_tools>
          </tools>

          <workflow_building>
            <existing_workflow_handling>
              ALWAYS call get_active_workflow first when the user starts a
              conversation.
              - If there IS an active workflow with configured steps, briefly
                describe what it does and ask whether to modify it or start new.
              - If the active workflow is empty (only unconfigured trigger), use
                it directly.
              - If there is NO active workflow, create one with create_workflow.
            </existing_workflow_handling>

            <trigger_configuration>
              The trigger (step index 0) defines what starts the workflow.
              - If the request implies a trigger ("on schedule", "when an order
                is created"), configure it with configure_step.
              - For schedule-based: appSlug "schedule", componentKey
                "schedule-custom-interval" or similar.
              - For internal events: check list_custom_triggers.
              - For app-event triggers: use MCP tool discovery.
              - If the trigger is unclear, ask briefly. It's OK to leave it
                unconfigured while the user decides.
            </trigger_configuration>

            <component_key_discovery>
              NEVER guess or invent component keys. They must come from:
              - list_app_components — the PRIMARY way. Call it with the app slug
                before calling configure_step for a new step.
              - A previous successful configure_step result.
              - The get_active_workflow result (componentKey field).
            </component_key_discovery>

            <error_handling>
              If configure_step fails (e.g. 404):
              - Do NOT create a new step. The existing step is still there.
              - Retry configure_step on the SAME step with a corrected key.
              - Use list_app_components or MCP discovery to find the correct key.
              - If you still can't find it, tell the user and ask what to use.
            </error_handling>

            <account_connections>
              When configure_step returns requiresAccountConnection: true, tell
              the user which accounts need to be connected. List ALL steps that
              need connections at the end of the workflow summary.
            </account_connections>

            <property_configuration>
              After calling configure_step, you MUST call set_step_props to fill in
              property values for the step. configure_step returns allProperties —
              use that to know which props exist and their types/descriptions.

              - For required properties: ALWAYS set a value. Ask the user if you
                can't infer a reasonable default.
              - For optional properties with sensible defaults: set them if the
                user's request implies specific values.
              - For properties with remoteOptions: true, note that those need
                dynamic values (e.g., Slack channel IDs). Set them to the best
                value you can infer from context (channel name, etc.).
              - For properties with fixed options, pick the matching option value.

              Example flow:
              1. configure_step → returns allProperties with "text", "conversation"
              2. set_step_props → { "text": "Weekly summary", "conversation": "#general" }
            </property_configuration>

            <building_sequence>
              1. Call list_app_components to discover correct keys before configuring.
              2. Use create_workflow only if you need a new one.
              3. Configure the trigger step if the user's intent is clear.
              4. Use add_workflow_step + configure_step for each action.
              5. IMMEDIATELY call set_step_props after each configure_step to fill
                 in property values — steps with empty props are not useful.
              6. Always configure every action — unconfigured steps are useless.
              7. Use remove_workflow_step to remove unwanted steps.
              8. Use update_workflow_name to give it a descriptive name.
              9. Check list_custom_triggers for internal event triggers.
              10. After building, list steps that require account connections.
              11. Show a summary using the workflow-suggestion-card component.
            </building_sequence>
          </workflow_building>

          <step_references>
            Pipedream step references use the syntax {{steps.STEP_NAME.field.path}}.
            These are the ONLY way to pass data between workflow steps.

            <rules>
              - NEVER use computed expressions like moment(), Date.now(), new Date(),
                Math.random(), or any JavaScript runtime code inside {{...}} references.
                Only dot-path references to step data are valid.
              - Trigger data: {{steps.trigger.event.FIELD_PATH}}
              - Action output: {{steps.STEP_NAME.$return_value}} or
                {{steps.STEP_NAME.$return_value.field}}
              - Action exports: {{steps.STEP_NAME.EXPORT_NAME}}
              - STEP_NAME is the component key with hyphens replaced by underscores
                (e.g. component "google_calendar-list-events" → steps.google_calendar_list_events)
            </rules>

            <trigger_schemas>
              For known trigger types, you can reference these fields immediately
              WITHOUT testing:
              ${this.buildTriggerSchemaPrompt()}
            </trigger_schemas>

            <action_output_discovery>
              For action steps, you MUST discover the output schema before referencing it:
              1. Configure the step fully (configure_step + set_step_props).
              2. Ask the user to test the step: "I need to test this step to discover
                 what data it returns. Should I run it now?"
              3. Call test_step to execute it. This stores the output schema.
              4. Use the returned outputSchema to construct valid references.

              NEVER guess action output fields. If a step hasn't been tested
              (tested: false in get_active_workflow), you don't know its output shape.
              Ask the user to test it first.
            </action_output_discovery>
          </step_references>

          <style_and_output>
            - Use informal, friendly, but clear language.
            - Always use the first person and contractions ("I'll", "you'll").
            - NEVER refer to the user as "the user" or "the customer". Use "you".
            - Be brief. Limit output to a few sentences.
            - NEVER use filler phrases like "To achieve this" or "Let's get started".
              Just do it.
            - NEVER reference tool names — describe what you're doing instead.
            - If you need clarification, ask a concise question.
          </style_and_output>
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
