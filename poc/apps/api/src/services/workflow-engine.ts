import type { PipedreamClient } from '@pipedream/sdk/server';
import type { Workflow, PipedreamStep, StepSnapshot } from '../models/workflow.model';
import type { ENV_VARS } from '../env-vars';
import type {
  ExecutionRun,
  ExecutionStepResult,
  ExecutionTriggerSource,
} from '../models/execution-run.model';
import { getWorkflow, saveWorkflow } from './workflow-store';
import { createRunId, saveExecutionRun } from './execution-store';
import type { Db } from '../db';
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
      const path = singleMatch[1].trim();
      const resolved = getAtPath(context, path.split('.'));
      if (resolved === undefined) {
        throw new Error(`Unresolved interpolation: {{${path}}} — path does not exist in the execution context`);
      }
      return (resolved !== null && typeof resolved === 'object')
        ? JSON.stringify(resolved)
        : resolved;
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
      const trimmed = path.trim();
      const resolved = getAtPath(context, trimmed.split('.'));
      if (resolved === undefined) {
        throw new Error(`Unresolved interpolation: {{${trimmed}}} — path does not exist in the execution context`);
      }
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
  db: Db,
  env: ENV_VARS,
  workflowId: string,
  externalUserId: string,
): Promise<Workflow> {
  const workflow = await getWorkflow(db, workflowId);
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
      emitOnDeploy: true,
    });
    console.log('deploy trigger response', JSON.stringify(response, null, 2));

    workflow.deployedTriggerId = (response as any).data?.id;
  } else if (trigger.data.source === 'custom') {
    workflow.customTriggerId = trigger.data.customTriggerId;
    // customTriggerId is a column on the workflow row; saveWorkflow below persists it.
  }

  workflow.status = 'published';
  workflow.lastError = undefined;
  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(db, workflow);
  return workflow;
}

export async function updateDeployedTrigger(
  pd: PipedreamClient,
  db: Db,
  workflowId: string,
  externalUserId: string,
  newTriggerData: PipedreamStep,
): Promise<Workflow> {
  const workflow = await getWorkflow(db, workflowId);
  if (!workflow) throw new Error('Workflow not found');
  if (workflow.externalUserId !== externalUserId) throw new Error('Forbidden');
  if (!workflow.deployedTriggerId) throw new Error('No deployed trigger to update');

  const configuredProps = normalizeAppProps(
    newTriggerData.configuredProps as Record<string, unknown>,
    newTriggerData.component.configurableProps,
  );

  await pd.deployedTriggers.update(workflow.deployedTriggerId, {
    externalUserId,
    configuredProps,
  });

  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(db, workflow);
  return workflow;
}

export async function unpublishWorkflow(
  pd: PipedreamClient,
  db: Db,
  workflowId: string,
  externalUserId: string,
): Promise<Workflow> {
  const workflow = await getWorkflow(db, workflowId);
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

  workflow.status = 'draft';
  workflow.deployedTriggerId = undefined;
  workflow.customTriggerId = undefined;
  workflow.lastError = undefined;
  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(db, workflow);
  return workflow;
}

// ── Schedule trigger synthetic event ─────────────────────────────────────────

/**
 * Builds a per-timezone section matching Pipedream's schedule trigger event shape.
 * Replicates the structure of `timezone_configured` / `timezone_utc` from the
 * Pipedream "Generate Test Event" internal call (observed via HAR).
 */
function buildTimezoneSection(now: Date, tz: string): Record<string, unknown> {
  const pad = (n: number) => String(n).padStart(2, '0');

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const year = parseInt(get('year'));
  const month = parseInt(get('month'));
  const day = parseInt(get('day'));
  let hour = parseInt(get('hour'));
  const minute = parseInt(get('minute'));
  const second = parseInt(get('second'));
  const millisecond = now.getMilliseconds();
  if (hour === 24) hour = 0; // some Intl impls emit "24" for midnight

  // Offset string: "GMT+05:30" → "+05:30", "GMT" → "+00:00"
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const tzName = tzParts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offsetStr = tzName === 'GMT' ? '+00:00' : tzName.replace('GMT', '');

  // ISO weekday (1=Mon … 7=Sun) and Monday anchor
  const dayNameLong = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  }).format(now);
  const jsDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    .indexOf(dayNameLong); // 0=Sun … 6=Sat
  const isoDayOfWeek = jsDay === 0 ? 7 : jsDay; // 1=Mon … 7=Sun
  const daysSinceMon = (jsDay + 6) % 7;
  const mondayUtc = new Date(Date.UTC(year, month - 1, day - daysSinceMon));
  const startOfWeek = mondayUtc.toISOString().slice(0, 10);

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const prettyDate = `${monthNames[month - 1]} ${day}, ${year}`;
  const isPM = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const prettyTime = `${hour12}:${pad(minute)}:${pad(second)} ${isPM ? 'PM' : 'AM'}`;
  const time24h = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  const dateIso = `${year}-${pad(month)}-${pad(day)}`;
  const timeIso = `${pad(hour)}:${pad(minute)}:${pad(second)}${offsetStr}`;

  return {
    date: { day, month, year },
    iso8601: { date: dateIso, time: timeIso, timestamp: `${dateIso}T${timeIso}` },
    metadata: { day_name: dayNameLong, day_of_week: isoDayOfWeek, start_of_week: startOfWeek },
    pretty: { date: prettyDate, time: prettyTime, time_24h: time24h },
    time: { hour, millisecond, minute, second },
    timezone: tz,
  };
}

/**
 * Generates a synthetic schedule trigger event that exactly matches the shape
 * Pipedream produces via its internal `timerInterfaceEmit` mutation.
 */
export function buildScheduleSampleEvent(
  configuredProps: Record<string, unknown>,
): Record<string, unknown> {
  const cron = (configuredProps.cron as string | undefined) ?? '0 * * * *';
  const timezone = (configuredProps.timezone as string | undefined) ?? 'UTC';
  const now = new Date();
  return {
    cron,
    timestamp: Math.floor(now.getTime() / 1000),
    timezone_configured: buildTimezoneSection(now, timezone),
    timezone_utc: buildTimezoneSection(now, 'UTC'),
  };
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface TestStepResult {
  success: boolean;
  outputSnapshot: StepSnapshot | null;
  error: string | null;
}

/**
 * Tests a single action step using stored snapshots from previous steps as the
 * interpolation context. Enforces sequential order, resolves {{steps.*}} references,
 * runs the step, and persists the resulting snapshot on the workflow.
 */
export async function testStep(
  pd: PipedreamClient,
  db: Db,
  workflow: Workflow,
  stepId: string,
): Promise<TestStepResult> {
  const stepIndex = workflow.steps.findIndex((s) => s.id === stepId);
  if (stepIndex < 0) {
    return { success: false, outputSnapshot: null, error: 'Step not found' };
  }
  if (stepIndex === 0) {
    return { success: false, outputSnapshot: null, error: 'Trigger steps cannot be tested directly' };
  }

  const step = workflow.steps[stepIndex];
  if (!step.data || step.data.source !== 'pipedream') {
    return { success: false, outputSnapshot: null, error: 'Step must be configured before testing' };
  }

  const prevStep = workflow.steps[stepIndex - 1];
  if (!prevStep?.tested) {
    const prevLabel =
      prevStep?.data?.source === 'pipedream'
        ? (prevStep.data as PipedreamStep).component?.key ?? `step ${stepIndex}`
        : `step ${stepIndex}`;
    return {
      success: false,
      outputSnapshot: null,
      error: `Step cannot be tested until the previous step ("${prevLabel}") is tested first.`,
    };
  }

  // Build interpolation context from the stored snapshots of preceding steps
  const stepsContext: Record<string, unknown> = {};
  for (let i = 0; i < stepIndex; i++) {
    const s = workflow.steps[i];
    if (!s.outputSnapshot) continue;
    if (i === 0) {
      stepsContext['trigger'] = { event: s.outputSnapshot.$return_value };
    } else if (s.data?.source === 'pipedream') {
      const key = (s.data as PipedreamStep).component?.key;
      if (key) {
        stepsContext[slugFromKey(key)] = {
          $return_value: s.outputSnapshot.$return_value,
          ...s.outputSnapshot.exports,
        };
      }
    }
  }

  const pdStep = step.data as PipedreamStep;
  const componentKey = pdStep.component.key;
  if (!componentKey) {
    return { success: false, outputSnapshot: null, error: 'Component has no key' };
  }

  const rawProps = pdStep.configuredProps as Record<string, unknown>;
  const missingRequired = (pdStep.component.configurableProps ?? [])
    .filter((p) => !p.optional)
    .filter((p) => {
      const val = rawProps[p.name];
      if (p.type === 'app') {
        // Stored as a bare authProvisionId string; normalizeAppProps wraps it later
        return !val || (typeof val === 'string' && !val.trim());
      }
      return val === undefined || val === null || val === '';
    })
    .map((p) => p.label ?? p.name);

  if (missingRequired.length > 0) {
    return {
      success: false,
      outputSnapshot: null,
      error: `Cannot test step — required properties not configured: ${missingRequired.join(', ')}`,
    };
  }

  try {
    const resolvedProps = resolveInterpolations(
      pdStep.configuredProps as Record<string, unknown>,
      { steps: stepsContext },
    ) as Record<string, unknown>;

    const configuredProps = normalizeAppProps(resolvedProps, pdStep.component.configurableProps);

    const payload = { id: componentKey, externalUserId: workflow.externalUserId, configuredProps };
    console.log(JSON.stringify({ testStep: componentKey, payload }, null, 2));
    const result = await pd.actions.run(payload);
    console.log(JSON.stringify({ testStep: componentKey, result }, null, 2));

    const typedResult = result as {
      ret?: unknown;
      exports?: Record<string, unknown>;
      os?: Array<{ k: string; err?: { message?: string } }>;
    };

    const errorObs = typedResult.os?.find((o) => o.k === 'error');
    if (errorObs) {
      return { success: false, outputSnapshot: null, error: errorObs.err?.message ?? 'Step returned an error' };
    }

    const snapshot: StepSnapshot = {
      $return_value: typedResult.ret ?? null,
      exports: typedResult.exports ?? {},
    };
    step.outputSnapshot = snapshot;
    step.tested = true;
    workflow.updatedAt = new Date().toISOString();
    await saveWorkflow(db, workflow);

    return { success: true, outputSnapshot: snapshot, error: null };
  } catch (err) {
    return { success: false, outputSnapshot: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface StepExecutionResult {
  stepId: string;
  componentKey: string;
  status: 'success' | 'error';
  output?: unknown;
  error?: string;
}

export async function executeWorkflow(
  pd: PipedreamClient,
  db: Db,
  workflow: Workflow,
  triggerPayload: unknown,
  triggerSource: ExecutionTriggerSource = 'pipedream',
  triggerEventId?: string,
): Promise<ExecutionRun> {
  const now = new Date().toISOString();
  const run: ExecutionRun = {
    id: createRunId(),
    workflowId: workflow.id,
    externalUserId: workflow.externalUserId,
    triggerSource,
    triggerEventId,
    triggerEvent: triggerPayload,
    status: 'running',
    steps: [],
    startedAt: now,
  };

  // Persist initial running state
  await saveExecutionRun(db, run);

  // steps context is keyed by component slug (e.g. "google_calendar_list_events")
  // matching Pipedream's {{steps.X.Y}} interpolation convention.
  const stepsContext: Record<string, unknown> = {
    trigger: { event: triggerPayload },
  };

  for (const step of workflow.steps.slice(1)) {
    if (!step.data || step.data.source !== 'pipedream') continue;

    const pdStep = step.data as PipedreamStep;
    const componentKey = pdStep.component.key;
    if (!componentKey) continue;

    const stepStartedAt = new Date().toISOString();

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

      // Store snapshot so the step's output paths are available for downstream reference validation
      const snapshot: StepSnapshot = {
        $return_value: typedResult.ret ?? null,
        exports: typedResult.exports ?? {},
      };
      step.outputSnapshot = snapshot;
      step.tested = true;

      run.steps.push({
        stepId: step.id,
        componentKey,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString(),
        status: 'success',
        output: stepOutput,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      run.steps.push({
        stepId: step.id,
        componentKey,
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString(),
        status: 'error',
        error: errorMsg,
      });

      run.status = 'error';
      run.error = `Step ${componentKey} failed: ${errorMsg}`;
      run.completedAt = new Date().toISOString();
      await saveExecutionRun(db, run);

      workflow.lastError = run.error;
      workflow.updatedAt = new Date().toISOString();
      await saveWorkflow(db, workflow);
      return run;
    }
  }

  run.status = 'success';
  run.completedAt = new Date().toISOString();
  await saveExecutionRun(db, run);

  // Persist snapshots and tested flags stored on each step during execution
  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(db, workflow);

  return run;
}

// ── Capture Event ────────────────────────────────────────────────────────────

/**
 * Captures a sample event from the workflow's trigger by doing a fresh poll,
 * regardless of whether the workflow is published or draft:
 *
 * - Schedule triggers  → synthetic event, returned immediately.
 * - Pipedream app triggers → temporarily deploy the trigger with
 *   `emitOnDeploy: true`, poll for the emitted event (up to `timeoutMs`),
 *   then delete the temporary deployment.
 * - Custom triggers → return a minimal placeholder event.
 *
 * The caller is responsible for persisting the event (see `appendTriggerEvent`)
 * and updating the trigger step's `outputSnapshot`.
 */
export async function captureEvent(
  pd: PipedreamClient,
  env: ENV_VARS,
  workflow: Workflow,
  externalUserId: string,
  timeoutMs: number = 60_000,
): Promise<{ event: Record<string, unknown> }> {
  const trigger = workflow.steps[0];
  if (!trigger?.data) throw new Error('Trigger is not configured yet');

  let event: Record<string, unknown>;

  if (trigger.data.source === 'pipedream') {
    const pdStep = trigger.data as PipedreamStep;

    if (pdStep.app.nameSlug === 'schedule') {
      // Schedule triggers: build a synthetic event immediately, no deploy needed.
      event = buildScheduleSampleEvent(
        (pdStep.configuredProps ?? {}) as Record<string, unknown>,
      );
    } else {
      // All app triggers: deploy temporarily, poll for the emitted event, then clean up.
      if (!pdStep.component.key) throw new Error('Trigger component key is missing');

      const workerBaseUrl = env.WORKER_BASE_URL ?? 'https://example.com';
      const webhookUrl = `${workerBaseUrl}/api/webhooks/pipedream/${workflow.id}`;

      const deployResponse = await pd.triggers.deploy({
        id: pdStep.component.key,
        externalUserId,
        configuredProps: normalizeAppProps(
          (pdStep.configuredProps ?? {}) as Record<string, unknown>,
          pdStep.component.configurableProps,
        ),
        webhookUrl,
        emitOnDeploy: true,
      });

      const tempTriggerId = (deployResponse as { data?: { id?: string } }).data?.id;
      if (!tempTriggerId) throw new Error('Trigger deployment did not return an ID');

      let capturedEvent: Record<string, unknown> | null = null;
      const pollInterval = 1_000;
      const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
          const res = await pd.deployedTriggers.listEvents(tempTriggerId, {
            externalUserId,
            n: 1,
          });
          capturedEvent =
            (res as { data?: Array<{ e?: Record<string, unknown> }> }).data?.[0]
              ?.e ?? null;
          if (capturedEvent) break;
        }
      } finally {
        // Always remove the temporary deployment.
        try {
          await pd.deployedTriggers.delete(tempTriggerId, {
            externalUserId,
            ignoreHookErrors: true,
          });
        } catch {
          // Ignore cleanup failures — the trigger was only temporary.
        }
      }

      if (!capturedEvent) {
        throw new Error(
          'No event was emitted within the timeout. ' +
            'Trigger an event at your external service and try again.',
        );
      }
      event = capturedEvent;
    }
  } else if (trigger.data.source === 'custom') {
    // Custom triggers: return a minimal placeholder.
    event = { type: trigger.data.customTriggerId, payload: {} };
  } else {
    throw new Error('Unknown trigger type');
  }

  return { event };
}
