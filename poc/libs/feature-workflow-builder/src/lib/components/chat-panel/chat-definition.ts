import {
  inject,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import {
  exposeComponent,
  uiChatResource,
  createTool,
  type UiChatResourceRef,
} from '@hashbrownai/angular';
import { createHttpTransport } from '@hashbrownai/core';
import { type Chat, prompt, s } from '@hashbrownai/core';
import { PipedreamMcpService, WorkflowService } from '@poc/data-access-api';
import { PipedreamClientService, CUSTOM_TRIGGERS } from '@poc/connect-angular';
import { AiStructuredCompletionService, ChatProviderService } from '@poc/data-access-structured-completion';
import type { PipedreamStep, StepOutputSchema } from '@poc/data-access-api';
import {
  getTriggerSchema,
  KNOWN_TRIGGER_SCHEMAS,
} from '../../models/trigger-schemas';
import { MarkdownComponent } from '@poc/ui-chat-elements';
import { ConnectAppComponent } from './connect-app.component';
import { CaptureEventComponent } from './components/capture-event.component';
import { PropOption, PropOptionValue } from '@pipedream/sdk';
import { validateStepReferences } from './step-reference.utils';
import { validatePropTypes, isPropOptional, isConfigurableProp } from '@poc/shared';
import { WorkflowSuggestionCard } from './components/workflow-suggestions-card.component';

/**
 * Per-component instructions injected into the configure_step response.
 * Keyed by Pipedream component key. Add entries here to guide the LLM on
 * how to configure specific components without bloating the system prompt.
 *
 * Instructions arrive in the tool result exactly when the LLM has just
 * loaded the component and is deciding what props to set — best possible timing.
 */
/**
 * Manual validation for specific component/app combinations.
 * Returns a user-facing error string if the component should be rejected,
 * or null if it is acceptable. Runs before any workflow state is mutated.
 */
function getComponentError(appSlug: string, componentKey: string): string | null {
  if (appSlug === 'openai') {
    console.log(JSON.parse(JSON.stringify({componentKey})));
    const validKey = 'openai-chat';
    if (componentKey !== validKey) {
      return `Component '${componentKey}' is deprecated. Use "${validKey}" generic chat "componentKey" instead — call list_app_components to confirm the correct key, then retry configure_step with it.`;
    }
  }
  return null;
}

function getComponentHint(appSlug: string, _componentKey: string): string | null {
  // All OpenAI actions: prefer chat completions + cheapest model.
  if (appSlug === 'openai') {
    // All other OpenAI actions: default to the cheapest available model.
    return 'Use the "gpt-4o-mini" model unless the user has asked for a specific one. If not available, prefer the simplest and cheapest model from the available options list.';
  }

  return null;
}

export class AIChatDefinition {
  private readonly injector = inject(Injector);
  private readonly mcpService = inject(PipedreamMcpService);
  private readonly pdClient = inject(PipedreamClientService);
  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly providerService = inject(ChatProviderService);
  private readonly completionService = inject(AiStructuredCompletionService);

  private readonly createWorkflowTool = createTool({
    name: 'create_workflow',
    description:
      'Create a new workflow with the given name. Returns the workflow ID.',
    schema: s.object('CreateWorkflowInput', {
      name: s.string('The name of the workflow'),
    }),
    handler: async (input) => {
      const workflow = await this.workflowService.createWorkflow(input.name);
      return { workflowId: workflow.id };
    },
  });

  private readonly addStepTool = createTool({
    name: 'add_workflow_step',
    description:
      'Add a new action step to the workflow. ' +
      "Pass afterStepId to insert it immediately after a specific step (by that step's ID). " +
      'Omit afterStepId to append it at the end. ' +
      'The trigger step (index 0) cannot be used as afterStepId to insert at position 1 — just omit afterStepId and reorder afterward if needed. ' +
      'Returns the new step ID.',
    schema: s.object('AddStepInput', {
      workflowId: s.string('The workflow ID'),
      stepName: s.string('Human readable name of the step'),
      afterStepId: s.string(
        'Step ID to insert after. Omit to append to the end.',
      ),
    }),
    handler: async (input) => {
      const afterStepId = (input as { afterStepId?: string }).afterStepId;
      const step = this.workflowService.addStep(input.workflowId, afterStepId);
      // Do NOT save here — configure_step always saves after configuring the step,
      // so we avoid persisting an unconfigured (data: null) step to the backend.
      return { stepId: step.id };
    },
  });

  private readonly moveStepTool = createTool({
    name: 'move_workflow_step',
    description:
      'Move an existing action step to a new position in the workflow. ' +
      'The trigger (index 0) can never be moved or displaced. ' +
      'Provide the step to move and the step it should be placed immediately AFTER. ' +
      'To move a step to position 1 (first action, right after the trigger), ' +
      'pass the trigger step ID as afterStepId. ' +
      'Invalidates outputSnapshot for all steps that come after the moved step — warn the user they may need to re-test those steps.',
    schema: s.object('MoveStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to move'),
      afterStepId: s.string(
        'The step ID to place the moved step immediately after. ' +
          'Pass the trigger step ID to move this step to position 1.',
      ),
    }),
    handler: async (input) => {
      const workflow = this.workflowService
        .workflows()
        .find((w) => w.id === input.workflowId);
      if (!workflow) return { success: false, error: 'Workflow not found' };

      const steps = workflow.steps;
      const fromIdx = steps.findIndex((s) => s.id === input.stepId);
      const anchorIdx = steps.findIndex((s) => s.id === input.afterStepId);

      if (fromIdx < 0) return { success: false, error: 'Step not found' };
      if (fromIdx === 0)
        return { success: false, error: 'Cannot move the trigger step' };
      if (anchorIdx < 0)
        return { success: false, error: 'afterStepId not found' };

      // Target index is after the anchor, adjusted for the removal of the source item
      const toIdx = anchorIdx < fromIdx ? anchorIdx + 1 : anchorIdx;

      if (toIdx === fromIdx)
        return { success: true, message: 'Step is already in that position' };
      if (toIdx === 0)
        return { success: false, error: 'Cannot displace the trigger step' };

      await this.workflowService.reorderSteps(input.workflowId, fromIdx, toIdx);
      await this.workflowService.save(input.workflowId);
      return { success: true };
    },
  });

  private readonly clearStepConfigTool = createTool({
    name: 'clear_step_config',
    description:
      'Clear the configuration of a step, resetting it to an unconfigured blank slot ' +
      'without removing it from the workflow. ' +
      'Use this when you want to REPLACE what a step does (change its app/component) ' +
      'rather than deleting it entirely. After clearing, call configure_step on the same step ID ' +
      'to assign a new app and component. ' +
      "Also clears the step's outputSnapshot — downstream steps that referenced it will need re-testing.",
    schema: s.object('ClearStepConfigInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to clear'),
      stepName: s.string('Human readable name of the step'),
    }),
    handler: async (input) => {
      this.workflowService.configureStep(input.workflowId, input.stepId, null);
      await this.workflowService.save(input.workflowId);
      return { success: true, stepId: input.stepId };
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
      appName: s.string('Human readable name for the app'),
      componentKey: s.string(
        'The Pipedream component key (e.g. "github-list-repos", "schedule-custom-interval")',
      ),
    }),
    handler: async (input) => {
      const workflow = this.workflowService
        .workflows()
        .find((w) => w.id === input.workflowId);
      if (!workflow) return { success: false, error: 'Workflow not found' };
      const stepExists = workflow.steps.some((s) => s.id === input.stepId);
      if (!stepExists)
        return {
          success: false,
          error: `Step '${input.stepId}' not found in workflow`,
        };

      const [appResponse, componentResponse] = await Promise.all([
        this.pdClient.getApp(input.appSlug),
        this.pdClient.getComponent(input.componentKey),
      ]);
      const app = appResponse.data;
      const component = componentResponse.data;
      if (!app)
        return { success: false, error: `App '${input.appSlug}' not found` };
      if (!component)
        return {
          success: false,
          error: `Component '${input.componentKey}' not found`,
        };

      const componentError = getComponentError(input.appSlug, input.componentKey);
      if (componentError) {
        return { success: false, error: componentError };
      }

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
        this.workflowService.setStepOutputSchema(
          input.workflowId,
          input.stepId,
          flatSchema,
        );
      }

      const props = component.configurableProps ?? [];
      const appProps = props
        .filter((p) => p.type === 'app')
        .map((p) => ({ type: p.type, app: p.app, name: p.name }));
      const requiredProps = props
        .filter((p) => {
          if (p.type === 'app') return false;
          return isConfigurableProp(p) && !isPropOptional(p)
        })
        .map((p) => ({
          name: p.name,
          label: p.label ?? p.name,
          type: p.type,
        }));

      await this.workflowService.save(input.workflowId);

      // For known trigger types, the static trigger schema embedded in the system
      // prompt is sufficient — the AI can reference event paths without a sample.
      if (triggerSchema) {
        await this.workflowService.save(input.workflowId);
      }

      const appData =
        !!appProps[0] && (await this.pdClient.getApp(appProps[0].app));
      const authType = appData?.data?.authType;
      const needsAuth = authType && authType !== 'none';

      const componentType = component.componentType ?? 'action';
      const testingInstruction = componentType === 'source'
        ? 'Then render pd-capture-event so the user can capture a sample trigger event — the trigger MUST have a captured event before any downstream step can reference its output.'
        : 'Then call test_step to execute it and capture its output snapshot — the step MUST be tested before any downstream step can reference its output.';

      const authBlock = needsAuth
        ? {
            BLOCKED_ON_ACCOUNT_CONNECTION: true,
            ACTION_REQUIRED:
              'You MUST render a pd-connect-app component for each entry in accountsToConnect and WAIT for the user before calling set_step_props. ' +
              'Pass each accountsToConnect object verbatim as the appProp input — do NOT construct the object yourself.',
          }
        : {
            NEXT_REQUIRED_ACTION:
              'Call set_step_props NOW for this step before configuring any other step. ' +
              'Do not add steps, do not call configure_step on another step, until set_step_props succeeds for this one. ' +
              testingInstruction,
          };

      const componentHint = getComponentHint(input.appSlug, input.componentKey);

      const result = {
        success: true,
        ...authBlock,
        ...(componentHint ? { COMPONENT_INSTRUCTIONS: componentHint } : {}),
        app: app.name,
        component: component.name,
        componentType,
        requiresAccountConnection: needsAuth,
        requiredProperties: requiredProps,
        triggerEventSchema: triggerSchema
          ? {
              name: triggerSchema.name,
              exampleReferences: triggerSchema.exampleReferences,
            }
          : null,
        allProperties: props
          .filter((p) => p.type !== 'app' && isConfigurableProp(p))
          .map((p) => ({
            name: p.name,
            label: p.label ?? p.name,
            type: p.type,
            description: p.description ?? '',
            optional: isPropOptional(p ),
            default: (p as any).default,
            options: (p as any).options ?? null,
            remoteOptions: !!p.remoteOptions,
          })),
      };
      console.log({ configure_step: result });
      return result;
    },
  });

  private readonly setStepPropsTool = createTool({
    name: 'set_step_props',
    description:
      'Set property values on an already-configured workflow step. Call this AFTER ' +
      "configure_step to fill in the step's required and optional properties. " +
      'You can call this multiple times to update props incrementally. ' +
      'Use the "type" field from configure_step allProperties to determine what value to pass — ' +
      'the value type must match exactly or the call will be rejected.',
    schema: s.object('SetStepPropsInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to set properties on'),
      props: s.array(
        'List of properties to set on the step',
        s.object(
          'PropEntry — CRITICAL: for props with options, the "value" field is the machine-readable selection the API requires (may be an ID, a slug, a code, or any non-display string). NEVER use the "label" — it is display text only and will be rejected or produce wrong results.',
          {
            name: s.string(
              'Property name — must exactly match a name from configure_step allProperties. ' +
                'Any unknown name will be rejected.',
            ),
            value: s.anyOf([
              s.string('String value for string props'),
              s.number('Numeric value for number/integer props'),
              s.boolean('Boolean value for boolean props'),
              s.array(
                'Array value for string[] or array props',
                s.string('Array item'),
              ),
              s.object('Timer value: polling interval in seconds — use for $.interface.timer props', {
                intervalSeconds: s.number('Polling interval in seconds (e.g. 900 for 15 minutes)'),
              }),
              s.object('Timer value: cron schedule — use for $.interface.timer props', {
                cron: s.string('Cron expression (e.g. "0 9 * * 1" for every Monday at 9 AM)'),
              }),
            ]),
          },
        ),
      ),
    }),
    handler: async (
      input,
    ): Promise<{
      success: boolean;
      error: string | null;
      configuredProps: Record<string, unknown> | null;
    }> => {
      console.log(JSON.parse(JSON.stringify({SET_PROPS: input})));
      const props: Record<string, PropOptionValue | string[] | Record<string, unknown>> = {};
      for (const entry of input.props as {
        name: string;
        value: string | number | boolean | string[] | Record<string, unknown>;
      }[]) {
        props[entry.name] = entry.value;
      }
      const workflow = this.workflowService
        .workflows()
        .find((w) => w.id === input.workflowId);
      if (!workflow)
        return {
          success: false,
          error: 'Workflow not found',
          configuredProps: null,
        };
      const step = workflow.steps.find((st) => st.id === input.stepId);
      if (!step?.data || step.data.source !== 'pipedream') {
        return {
          success: false,
          error: 'Step not configured yet — call configure_step first',
          configuredProps: null,
        };
      }
      const current = step.data as PipedreamStep;
      const validNames = new Set(
        (current.component.configurableProps ?? []).map((p) => p.name),
      );
      const unknown = Object.keys(props).filter((k) => !validNames.has(k));
      if (unknown.length > 0) {
        console.log('OOOHH', JSON.parse(JSON.stringify({ unknown })));
        return {
          success: false,
          error: `Unknown properties: ${unknown.join(', ')}. Only use names from configure_step's allProperties list.`,
          configuredProps: null,
        };
      }

      const typeValidation = validatePropTypes(
        props,
        (current.component.configurableProps ?? []) as Array<{
          name: string;
          type?: string;
        }>,
      );
      if (!typeValidation.valid) {
        return {
          success: false,
          error: typeValidation.message ?? '',
          configuredProps: null,
        };
      }

      const refCheck = validateStepReferences(props, workflow.steps);
      if (!refCheck.valid) {
        return {
          success: false,
          error: refCheck.error,
          configuredProps: null,
          ...(refCheck.availablePaths.length > 0
            ? { availablePaths: refCheck.availablePaths }
            : {}),
        };
      }

      // For props with remoteOptions, the LLM must use the machine-readable "value"
      // (e.g. a channel ID like "C0123456"), not the human-readable "label". Even with
      // explicit instructions, LLMs tend to rationalize using the label when the user
      // mentions a name directly (e.g. "#general"). We enforce correctness here by
      // fetching valid options and rejecting any value not in the list, returning the
      // options so the LLM can self-correct with the right value.
      for (const [key, val] of Object.entries(props)) {
        const propDef = current.component.configurableProps?.find(
          (p) => p.name === key,
        );
        if (!propDef?.remoteOptions) continue;
        try {
          const res = await this.pdClient.configureProp(
            current.component.key,
            key,
            current.configuredProps as Record<string, unknown>,
            current.component.configurableProps ?? [],
          );
          const options = (res.options ?? []).map((o) =>
            'lv' in o ? o.lv : o,
          );

          const validValues = options.map((o) => o.value);
          if (
            validValues.length > 0 &&
            !Array.isArray(val) &&
            typeof val !== 'object' &&
            !validValues.includes(val)
          ) {
            return {
              success: false,
              error:
                `Invalid value "${val}" for property "${key}". ` +
                `You must use the "value" field from the available options: ${JSON.stringify(options)}`,
              configuredProps: null,
            };
          }
        } catch {
          // If fetching options fails, allow the value through rather than blocking
        }
      }

      const merged = { ...current.configuredProps, ...props };
      this.workflowService.configureStep(input.workflowId, input.stepId, {
        ...current,
        configuredProps: merged,
      });
      await this.workflowService.save(input.workflowId);

      // If props were updated on the trigger step, the user can re-capture an
      // event via the Capture Event button to get an updated sample.
      const stepIndex = workflow.steps.findIndex((s) => s.id === input.stepId);
      void stepIndex;

      return {
        success: true,
        error: null,
        configuredProps: merged,
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
      appSlug: s.string(
        'The Pipedream app name_slug (e.g. "google_calendar", "slack_v2", "schedule")',
      ),
      appName: s.string('Human readable name for the app'),
      componentType: s.string(
        'Filter by type: "action" or "trigger". Pass empty string to list all.',
      ),
    }),
    handler: async (input) => {
      const type =
        input.componentType === 'action' || input.componentType === 'trigger'
          ? input.componentType
          : undefined;
      const response = await this.pdClient.listComponents({
        app: input.appSlug,
        componentType: type,
        limit: 100,
      });
      const components = (response.data ?? [])
        .filter((c) => !getComponentError(input.appSlug, c.key))
        .map((c) => ({
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
            app:
              step.data?.source === 'pipedream'
                ? (step.data as PipedreamStep).app?.name
                : null,
            component:
              step.data?.source === 'pipedream'
                ? (step.data as PipedreamStep).component?.name
                : null,
            componentKey:
              step.data?.source === 'pipedream'
                ? (step.data as PipedreamStep).component?.key
                : null,
            customTriggerId:
              step.data?.source === 'custom' ? step.data.customTriggerId : null,
            tested: step.tested ?? false,
            outputSnapshot: step.outputSnapshot ?? null,
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
    handler: async (input) => {
      this.workflowService.updateWorkflow(input.workflowId, {
        name: input.name,
      });
      await this.workflowService.save(input.workflowId);
      return { success: true, name: input.name };
    },
  });

  private readonly removeStepTool = createTool({
    name: 'remove_workflow_step',
    description:
      'Remove a step from a workflow by its step ID. Cannot remove the trigger step (index 0).',
    schema: s.object('RemoveStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to remove'),
      stepName: s.string('Human readable name for the step'),
    }),
    handler: async (input) => {
      this.workflowService.removeStep(input.workflowId, input.stepId);
      await this.workflowService.save(input.workflowId);
      return { success: true };
    },
  });

  private readonly testStepTool = createTool({
    name: 'test_step',
    description:
      'Test a configured ACTION step to capture its actual output. ' +
      'Do NOT call this on the trigger step (index 0) — triggers fire on their own and are ' +
      'automatically marked as ready when configured via configure_step. ' +
      'Action steps MUST be tested in order — step N can only be tested after step N-1 is tested. ' +
      'The step must be fully configured (configure_step + set_step_props) before testing. ' +
      'Some steps also require the user to connect an account first. ' +
      'After a successful test, the output snapshot is stored and set_step_props will validate ' +
      'any {{steps.STEP_NAME.*}} references against it.',
    schema: s.object('TestStepInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID to test'),
      stepName: s.string('Human readable name for the step'),
    }),
    handler: async (input) => {
      const result = await this.workflowService.testStep(
        input.workflowId,
        input.stepId,
      );
      await this.workflowService.save(input.workflowId);
      return result;
    },
  });

  private readonly getPropOptionsTool = createTool({
    name: 'get_prop_options',
    description:
      'Fetch available options for a step property that has remoteOptions: true. ' +
      'ALWAYS call this before setting a remoteOptions property via set_step_props — ' +
      'never guess or infer values for such properties. ' +
      'If this returns error: true, you MUST stop and inform the user — do NOT proceed with set_step_props for that property. ' +
      'On success, use the "value" field of each option (never "label") when calling set_step_props.',
    schema: s.object('GetPropOptionsInput', {
      workflowId: s.string('The workflow ID'),
      stepId: s.string('The step ID'),
      stepName: s.string('The human-readable step name shown in the UI'),
      propName: s.string('The property name to fetch options for'),
    }),
    handler: async (
      input,
    ): Promise<
      { error: false; options: PropOption[] } | { error: true; reason: string }
    > => {
      const workflow = this.workflowService
        .workflows()
        .find((w) => w.id === input.workflowId);
      const step = workflow?.steps.find((s) => s.id === input.stepId);
      if (!step?.data || step.data.source !== 'pipedream') {
        return {
          error: true,
          reason: 'Step not found or not a Pipedream step',
        };
      }
      const pdStep = step.data as PipedreamStep;
      try {
        const res = await this.pdClient.configureProp(
          pdStep.component.key,
          input.propName,
          pdStep.configuredProps as Record<string, unknown>,
          pdStep.component.configurableProps ?? [],
        );
        const options = (res.options ?? []).map((o) => ('lv' in o ? o.lv : o));
        console.log(
          JSON.parse(JSON.stringify({ input, getPropOptions: options })),
        );
        return { error: false, options };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to fetch options';
        return { error: true, reason: msg };
      }
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

  private readonly reviewWorkflowTool = createTool({
    name: 'review_workflow',
    description:
      "Spawn a sub-agent to critically review the current workflow against the user's stated intent. " +
      'Call this after the workflow is fully configured to catch problems before the user runs it. ' +
      'IMPORTANT: After the review returns, you MUST immediately fix every issue with severity "error" ' +
      'by calling the appropriate tools (set_step_props, clear_step_config + configure_step, etc.) ' +
      'WITHOUT asking the user first — fix silently and only report if you need information you cannot infer. ' +
      'Only present the workflow summary card once all errors are resolved.',
    schema: s.object('ReviewWorkflowInput', {
      userIntent: s.string(
        "The user's original goal for this workflow in their own words — what they want it to do and why",
      ),
    }),
    handler: async (
      input,
    ): Promise<{
      approved: boolean;
      summary: string;
      issues: {
        stepId: string;
        step: string;
        severity: string;
        description: string;
        fix: string;
      }[];
    }> => {
      const workflow = this.workflowService.activeWorkflow();
      if (!workflow)
        return {
          approved: false,
          summary: 'No active workflow found.',
          issues: [],
        };

      return this.completionService.complete({
        debugName: 'workflow-review',
        system: `You are a strict workflow quality reviewer. Your job is to find ONLY genuine blocking problems
— issues that will cause the workflow to FAIL AT RUNTIME or produce CLEARLY WRONG output for the stated intent.

WHAT COUNTS AS AN ERROR (severity: "error"):
- A required prop (optional: false AND no default value) that is not configured — will throw at runtime.
- A prop value that is syntactically invalid for its type (e.g. a plain integer string "900" set for a
  timer prop that expects an object like { intervalSeconds: 900 }).
- A step reference {{steps.X.field}} that points to a field not present in that step's outputSnapshot.
- A component that is explicitly deprecated in its own description AND a better replacement exists
  (e.g. the component description itself says "use the Chat action instead").
- A component whose purpose fundamentally mismatches the stated intent (e.g. "Send Email" when the
  user wanted to receive emails and reply).

WHAT COUNTS AS A WARNING (severity: "warning"):
- A component that is likely to produce poor results but won't crash (e.g. an outdated model that still
  works but produces lower quality output).
- A prop value that is technically valid but probably wrong given the user's intent.

DO NOT FLAG — these are NOT issues:
- Optional props (optional: true) that are not set. They have defaults and work fine.
- Props that have a default value and are not overridden. The default IS the configured value.
- Stylistic or preference choices.
- Things that "could be improved" but won't break the workflow.
- Labels/filters on triggers that are optional — leave them alone unless they're explicitly required.
- Any speculation about what MIGHT go wrong if some other setting were wrong.

IMPORTANT: Each issue must include the exact stepId from the workflow data so fixes can be applied programmatically.

The workflow data provided includes:
- Each step's configuredProps (what is currently set)
- Each step's component.configurableProps (all available props with their optional flag and default value)
- Each step's outputSnapshot (actual test run data, if available)

Cross-reference configuredProps against configurableProps to determine what is missing vs. what has a default.
Only an unset required prop with NO default is a genuine configuration error.`,
        input: {
          userIntent: input.userIntent,
          workflow,
        },
        schema: s.object('WorkflowReview', {
          approved: s.boolean(
            'True only if the workflow has no errors and will run correctly for the stated intent',
          ),
          summary: s.string('One or two sentence overall assessment'),
          issues: s.array(
            'Specific problems found — empty if approved',
            s.object('Issue', {
              stepId: s.string('The exact step ID from the workflow data (e.g. "1777040471639-xx462w")'),
              step: s.string('Human-readable step name for display'),
              severity: s.anyOf([
                s.string('"error" — will fail or produce clearly wrong results; must be fixed'),
                s.string('"warning" — likely to produce poor results but won\'t crash'),
              ]),
              description: s.string('What is wrong and why it matters — be specific about the prop and value'),
              fix: s.string('Exact action to resolve it: which tool to call, which prop to set, what value to use'),
            }),
          ),
        }),
      });
    },
  });

  private readonly clientTools = [
    this.getActiveWorkflowTool,
    this.createWorkflowTool,
    this.addStepTool,
    this.moveStepTool,
    this.clearStepConfigTool,
    this.listComponentsTool,
    this.configureStepTool,
    this.setStepPropsTool,
    this.getPropOptionsTool,
    this.testStepTool,
    this.removeStepTool,
    this.updateWorkflowNameTool,
    this.listCustomTriggersTool,
    this.reviewWorkflowTool,
  ];

  // ── Chat lifecycle ──────────────────────────────────────────────────────

  initChat(messages?: Chat.Message<any, any>[]): UiChatResourceRef<any> {
    return runInInjectionContext(this.injector, () => {
      const provider = this.providerService.active();
      return uiChatResource({
        model: provider.model,
        transport: createHttpTransport({ baseUrl: provider.baseUrl }),
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
              - add_workflow_step — add a step; pass afterStepId to insert at a position, omit to append
              - move_workflow_step — move an existing step to a different position by step ID
              - clear_step_config — reset a step's component without removing it (use before re-configuring)
              - list_app_components — discover correct component keys for an app
              - configure_step — configure a step with a Pipedream app and component
              - set_step_props — set property values on a configured step
              - test_step — execute a step to discover its output schema (REQUIRED before referencing outputs)
              - remove_workflow_step — remove a step from a workflow
              - update_workflow_name — rename a workflow
              - list_custom_triggers — list internal event triggers
              - review_workflow — run a sub-agent quality review before presenting the workflow as complete
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
              CRITICAL — read the configure_step result carefully:
              If BLOCKED_ON_ACCOUNT_CONNECTION is true in the result, you are
              FORBIDDEN from calling set_step_props on that step. Instead:

              1. Immediately render a pd-connect-app component for EACH app
                 listed in accountsToConnect.
              2. Tell the user they need to connect the account first.
              3. STOP and WAIT for the user to reply.
              4. Only after the user confirms the account is connected may you
                 proceed with set_step_props.

              Skipping this step will cause all subsequent API calls to fail
              because the account credentials are missing.
            </account_connections>

            <property_configuration>
              After calling configure_step, you MUST call set_step_props to fill in
              property values for the step. configure_step returns allProperties —
              use that to know which props exist and their types/descriptions.

              - For required properties: ALWAYS set a value. Ask the user if you
                can't infer a reasonable default.
              - For optional properties with sensible defaults: set them if the
                user's request implies specific values.
              - For properties with remoteOptions: true, you MUST call
                get_prop_options first to retrieve the valid {label, value} pairs,
                then use the "value" field (never the "label") in set_step_props.
                Never guess or infer values for remoteOptions properties — always
                fetch them. This is a general rule: labels are human-readable
                display text only; values are what the API requires.
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
              11. Call review_workflow with the user's original intent to catch any issues before finishing.
                  After it returns, IMMEDIATELY fix every "error" severity issue by calling the appropriate
                  tools (set_step_props, clear_step_config + configure_step, etc.) — do this silently
                  without asking the user. Only ask the user if you need information you cannot infer.
                  Call review_workflow again after fixing to confirm the workflow is clean.
              12. Show a summary using the workflow-suggestion-card component.
            </building_sequence>

            <workflow_editing>
              When the user asks to EDIT an existing workflow:

              <inserting_steps>
                To insert a step between two existing steps:
                1. Call add_workflow_step with afterStepId set to the step BEFORE the desired position.
                2. The new step lands immediately after that step.
                3. Configure it with configure_step + set_step_props as normal.
                4. Any steps after the new one may need re-testing if they reference prior step outputs.
              </inserting_steps>

              <replacing_a_step>
                To change what a step does (swap its app/component) without removing it:
                1. Call clear_step_config on the step — it resets to a blank slot, stays in position.
                2. Call configure_step on the same step ID with the new component.
                3. Call set_step_props for the new configuration.
                4. All downstream steps that referenced the old step's outputs MUST be re-tested —
                   warn the user and offer to re-test them.

                Do NOT do remove_workflow_step + add_workflow_step when the user just wants to
                change a step's app — clear_step_config keeps the step in place.
              </replacing_a_step>

              <reordering_steps>
                To move a step to a different position:
                1. Call move_workflow_step with the stepId and the afterStepId of the step
                   it should come after.
                2. To move a step to position 1 (right after the trigger), pass the trigger
                   step ID as afterStepId.
                3. Warn the user: any step whose inputs referenced the moved step, or whose
                   position in the execution order changed relative to its dependencies,
                   may need re-testing.
              </reordering_steps>

              <cascading_invalidation>
                When any of the following happens, downstream step snapshots become stale:
                - A step's props change (set_step_props)
                - A step is replaced (clear_step_config + configure_step)
                - A step is inserted or removed before downstream steps
                - A step is moved

                After edits, call get_active_workflow to see which steps still have
                outputSnapshot. Proactively warn the user which steps will need re-testing
                and offer to run them.
              </cascading_invalidation>

              <reconfiguring_trigger>
                To change the trigger:
                1. Call configure_step on the trigger step ID (index 0).
                2. If the trigger changes and the workflow is published, the backend
                   automatically unpublishes it — tell the user they'll need to publish again.
                3. Call set_step_props to update trigger-specific props.
                4. If the trigger type changed, the trigger's outputSnapshot is stale —
                   render pd-capture-event so the user can capture a fresh sample event.
              </reconfiguring_trigger>
            </workflow_editing>
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
              - ALWAYS use the most specific (deepest) path that contains the data
                the downstream prop actually needs. NEVER reference a parent object
                when a specific field inside it is what the prop requires.
                If a prop expects a string (e.g. a message body, subject, or label),
                navigate all the way to the leaf string field — passing an entire
                object will cause the step to receive "[object Object]" or a raw
                JSON blob, not the intended value.
                Example: a step returning { summary: "...", usage: {...} } —
                use {{steps.openai_step.$return_value.summary}} for a text field,
                NOT {{steps.openai_step.$return_value}}.
                When in doubt, check the outputSnapshot from test_step to pick the
                correct leaf path.
            </rules>

            <trigger_schemas>
              For known trigger types, you can reference these fields immediately
              WITHOUT testing:
              ${this.buildTriggerSchemaPrompt()}
            </trigger_schemas>

            <trigger_sample_event>
              The trigger step (index 0) must sometimes provide a sample event
              before you can configure downstream action steps — especially when
              a step references {{steps.trigger.event.*}} paths and the trigger
              is NOT a known schedule type with a built-in schema.

              When you need a trigger sample event and one is not already present
              in the step's outputSnapshot:
              1. Render a pd-capture-event component, passing the workflowId.
              2. Tell the user: "I need a sample event from your trigger so I know
                 what data it produces. Click Capture Event and I'll continue once it's
                 captured."
              3. STOP and wait. The component will send you a reply automatically
                 when the user clicks the button and the capture succeeds.
              4. After receiving the success reply, call get_active_workflow to
                 read the updated trigger outputSnapshot and proceed.

              For known schedule triggers the schema is embedded in this prompt —
              you do NOT need a sample event for those.

              Do NOT call test_step on the trigger step. Do NOT ask the user to
              "publish" the workflow to get a sample event — pd-capture-event works
              without publishing.
            </trigger_sample_event>

            <action_output_discovery>
              Trigger steps (index 0) are automatically marked as ready when
              configured — never call test_step on a trigger.

              For action steps, you MUST test the step before referencing its output:
              1. Configure the step fully (configure_step + set_step_props).
              2. Ask the user to test the step: "I need to test this step to discover
                 what data it returns. Should I run it now?"
              3. Call test_step to execute it. Steps must be tested in order — test
                 step N-1 before step N.
              4. Use the returned outputSnapshot to construct valid references.
                 set_step_props validates all {{steps.SLUG.*}} references against
                 the stored snapshot and rejects any path that does not exist.

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
          exposeComponent(MarkdownComponent, {
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
          exposeComponent(ConnectAppComponent, {
            description:
              'Show a button for the user to connect a Pipedream app account (OAuth). ' +
              'Use this when configure_step returns BLOCKED_ON_ACCOUNT_CONNECTION. ' +
              'Render one per entry in accountsToConnect.',
            input: {
              workflowId: s.string('The workflow ID'),
              stepId: s.string('The step ID being configured'),
            },
          }),
          exposeComponent(CaptureEventComponent, {
            description:
              'Show a "Capture Event" button that captures a sample event from the workflow trigger. ' +
              'Use this when you need trigger output data to configure downstream action steps ' +
              'and the trigger outputSnapshot is not yet available. ' +
              'Works without publishing the workflow. ' +
              'After the user clicks it, the component automatically sends a confirmation message ' +
              'so you can continue building.',
            input: {
              workflowId: s.string('The workflow ID'),
            },
          }),
        ],
        tools: [...this.mcpService.tools(), ...this.clientTools],
      });
    });
  }
}
