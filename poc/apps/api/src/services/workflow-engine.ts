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
  const stepOutputs: Record<string, unknown> = {
    trigger: { event: triggerPayload },
  };
  const results: StepExecutionResult[] = [];

  for (const step of workflow.steps.slice(1)) {
    if (!step.data || step.data.source !== 'pipedream') continue;

    const pdStep = step.data as PipedreamStep;
    const componentKey = pdStep.component.key;
    if (!componentKey) continue;

    try {
      const result = await pd.actions.run({
        id: componentKey,
        externalUserId: workflow.externalUserId,
        configuredProps: normalizeAppProps(
          pdStep.configuredProps as Record<string, unknown>,
          pdStep.component.configurableProps,
        ),
      });

      const typedResult = result as {
        ret?: unknown;
        exports?: Record<string, unknown>;
      };
      stepOutputs[step.id] = {
        ret: typedResult.ret,
        exports: typedResult.exports,
      };

      results.push({
        stepId: step.id,
        componentKey,
        status: 'success',
        output: typedResult.ret ?? typedResult.exports,
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
