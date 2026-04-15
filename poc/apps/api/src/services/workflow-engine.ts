import type { PipedreamClient } from '@pipedream/sdk/server';
import type { Workflow, PipedreamStep } from '../models/workflow.model';
import type { ENV_VARS } from '../env-vars';
import {
  getWorkflow,
  saveWorkflow,
  indexCustomTrigger,
  removeCustomTriggerIndex,
} from './workflow-store';
import { normalizeAppProps } from '../utils/normalize-props';

// ── Interpolation ────────────────────────────────────────────────────────────

/** Converts a component key like "google_calendar-list-events" → "google_calendar_list_events" */
export function slugFromKey(componentKey: string): string {
  return componentKey.replace(/-/g, '_');
}

export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Recursively resolves {{path.to.value}} template expressions in configuredProps.
 * When the entire string value is a single expression, returns the resolved value
 * as-is (preserving type). When embedded in a larger string, non-string values
 * are JSON-stringified. Unresolvable expressions are left as-is.
 */
export function resolveInterpolations(
  value: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const singleMatch = value.match(/^\{\{([^}]+)\}\}$/);
    if (singleMatch) {
      const resolved = getAtPath(context, singleMatch[1].trim().split('.'));
      return resolved !== undefined ? resolved : value;
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
      const resolved = getAtPath(context, path.trim().split('.'));
      if (resolved === undefined) return match;
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveInterpolations(item, context));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveInterpolations(v, context),
      ]),
    );
  }
  return value;
}

// ── Publish / Unpublish ─────────────────────────────────────────────────────

export async function publishWorkflow(
  pd: PipedreamClient,
  kv: KVNamespace,
  env: ENV_VARS,
  workflowId: string,
  externalUserId: string,
): Promise<Workflow> {
  const workflow = await getWorkflow(kv, workflowId);
  if (!workflow) throw new Error('Workflow not found');
  if (workflow.externalUserId !== externalUserId) throw new Error('Forbidden');
  if (workflow.status === 'published')
    throw new Error('Workflow already published');

  const trigger = workflow.steps[0];
  if (!trigger?.data) throw new Error('Trigger not configured');

  const actionSteps = workflow.steps.slice(1).filter((s) => s.data);
  if (actionSteps.length === 0) throw new Error('No action steps configured');

  if (trigger.data.source === 'pipedream') {
    const pdStep = trigger.data as PipedreamStep;
    const workerBaseUrl = env.WORKER_BASE_URL;
    if (actionSteps.length === 0) {
      throw new Error('No base url configured');
    }
    const webhookUrl = `${workerBaseUrl}/api/webhooks/pipedream/${workflow.id}`;

    const response = await pd.triggers.deploy({
      id: pdStep.component.key!,
      externalUserId,
      configuredProps: normalizeAppProps(
        pdStep.configuredProps as Record<string, unknown>,
        pdStep.component.configurableProps,
      ),
      webhookUrl,
      emitOnDeploy: false,
    });

    workflow.deployedTriggerId = (response as any).data?.id;
  } else if (trigger.data.source === 'custom') {
    workflow.customTriggerId = trigger.data.customTriggerId;
    await indexCustomTrigger(
      kv,
      trigger.data.customTriggerId,
      externalUserId,
      workflow.id,
    );
  }

  workflow.status = 'published';
  workflow.lastError = undefined;
  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(kv, workflow);
  return workflow;
}

export async function unpublishWorkflow(
  pd: PipedreamClient,
  kv: KVNamespace,
  workflowId: string,
  externalUserId: string,
): Promise<Workflow> {
  const workflow = await getWorkflow(kv, workflowId);
  if (!workflow) throw new Error('Workflow not found');
  if (workflow.externalUserId !== externalUserId) throw new Error('Forbidden');

  if (workflow.deployedTriggerId) {
    try {
      await pd.deployedTriggers.delete(workflow.deployedTriggerId, {
        externalUserId,
        ignoreHookErrors: true,
      });
    } catch (err) {
      console.error('Failed to delete deployed trigger:', err);
    }
  }

  if (workflow.customTriggerId) {
    await removeCustomTriggerIndex(
      kv,
      workflow.customTriggerId,
      externalUserId,
      workflow.id,
    );
  }

  workflow.status = 'draft';
  workflow.deployedTriggerId = undefined;
  workflow.customTriggerId = undefined;
  workflow.lastError = undefined;
  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(kv, workflow);
  return workflow;
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface StepExecutionResult {
  stepId: string;
  componentKey: string;
  status: 'success' | 'error';
  output?: unknown;
  error?: string;
}

export async function executeWorkflow(
  pd: PipedreamClient,
  kv: KVNamespace,
  workflow: Workflow,
  triggerPayload: unknown,
): Promise<StepExecutionResult[]> {
  // steps context is keyed by component slug (e.g. "google_calendar_list_events")
  // matching Pipedream's {{steps.X.Y}} interpolation convention.
  const stepsContext: Record<string, unknown> = {
    trigger: { event: triggerPayload },
  };
  const results: StepExecutionResult[] = [];

  for (const step of workflow.steps.slice(1)) {
    if (!step.data || step.data.source !== 'pipedream') continue;

    const pdStep = step.data as PipedreamStep;
    const componentKey = pdStep.component.key;
    if (!componentKey) continue;

    try {
      const resolvedProps = resolveInterpolations(
        pdStep.configuredProps as Record<string, unknown>,
        { steps: stepsContext },
      ) as Record<string, unknown>;

      const configuredProps = normalizeAppProps(
        resolvedProps,
        pdStep.component.configurableProps,
      );

      const payload = {
        id: componentKey,
        externalUserId: workflow.externalUserId,
        configuredProps,
      }
      console.log((JSON.stringify({componentKey, payload}, null, 2)));
      const result = await pd.actions.run(payload);
      console.log((JSON.stringify({componentKey, result}, null, 2)));

      const typedResult = result as {
        ret?: unknown;
        exports?: Record<string, unknown>;
        os?: Array<{ k: string; err?: { message?: string } }>;
      };

      // pd.actions.run does not throw on step-level errors — they arrive as
      // observations with k === 'error' in the os array.
      const errorObs = typedResult.os?.find((o) => o.k === 'error');
      if (errorObs) {
        throw new Error(errorObs.err?.message ?? 'Step returned an error');
      }
      // Use $return_value to match Pipedream's {{steps.X.$return_value}} convention
      const stepOutput: Record<string, unknown> = {
        $return_value: typedResult.ret,
        ...typedResult.exports,
      };
      stepsContext[slugFromKey(componentKey)] = stepOutput;

      results.push({
        stepId: step.id,
        componentKey,
        status: 'success',
        output: stepOutput,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        stepId: step.id,
        componentKey,
        status: 'error',
        error: errorMsg,
      });

      workflow.lastError = `Step ${componentKey} failed: ${errorMsg}`;
      workflow.updatedAt = new Date().toISOString();
      await saveWorkflow(kv, workflow);
      break; // Stop chain on failure
    }
  }

  return results;
}
