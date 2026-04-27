import { Hono } from 'hono';
import type { ENV_VARS } from '../env-vars';
import type { Workflow, WorkflowStep, PipedreamStep } from '../models/workflow.model';
import { validatePropTypes } from '@poc/shared';
import {
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
} from '../services/workflow-store';
import {
  publishWorkflow,
  unpublishWorkflow,
  executeWorkflow,
  captureEvent,
  testStep,
} from '../services/workflow-engine';
import {
  listTriggerEvents,
  getTriggerEvent,
  appendTriggerEvent,
} from '../services/trigger-event-store';
import { isEqual } from 'lodash-es';
import {
  listExecutionRuns,
  getExecutionRun,
} from '../services/execution-store';
import { createPipedreamClient } from '../utils/pipedream';
import { createDb } from '../db';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compares incoming steps against the stored steps and clears outputSnapshot /
 * outputSchema / tested on any step — and every step after it — where:
 *   - the step ID at a given position changed (insertion, removal, reorder), OR
 *   - the step's data (component + configuredProps) changed.
 *
 * This makes the backend the authoritative source for snapshot freshness.
 * The frontend also clears eagerly for immediate UI feedback, but the response
 * from this endpoint is what the frontend ultimately stores.
 */
function invalidateStaleSnapshots(
  oldSteps: WorkflowStep[],
  newSteps: WorkflowStep[],
): WorkflowStep[] {
  let invalidateFrom = newSteps.length; // sentinel: nothing changed

  for (let i = 0; i < newSteps.length; i++) {
    const old = oldSteps[i];
    const next = newSteps[i];

    // Step identity changed at this position (inserted, removed, or reordered).
    if (!old || old.id !== next.id) {
      invalidateFrom = i;
      break;
    }

    // Same step, but its component or configured props changed.
    if (!isEqual(old.data, next.data)) {
      invalidateFrom = i;
      break;
    }
  }

  if (invalidateFrom >= newSteps.length) return newSteps;

  return newSteps.map((step, i) =>
    i >= invalidateFrom
      ? { ...step, snapshotStale: true, outputSchema: null, tested: false }
      : step,
  );
}

const workflows = new Hono<{ Bindings: ENV_VARS }>();

// List workflows for a user
workflows.get('/', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const items = await listWorkflows(db, externalUserId);
  return c.json({ workflows: items });
});

// Create workflow
workflows.post('/', async (c) => {
  const body = await c.req.json();
  const { externalUserId, name = 'New Workflow' } = body;
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const now = new Date().toISOString();
  const workflow: Workflow = {
    id: generateId(),
    name,
    description: '',
    steps: [{ id: generateId(), type: 'trigger', data: null }],
    status: 'draft',
    externalUserId,
    createdAt: now,
    updatedAt: now,
  };

  const db = createDb(c.env.DB);
  await saveWorkflow(db, workflow);
  return c.json({ workflow }, 201);
});

// List all published workflows for a user (must be before /:id to avoid route shadowing)
workflows.get('/deployed-triggers', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const all = await listWorkflows(db, externalUserId);
  const published = all.filter((w) => w.status === 'published');
  return c.json({ workflows: published });
});

// Get single workflow
workflows.get('/:id', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ workflow });
});

// Save full workflow
workflows.put('/:id', async (c) => {
  const body = await c.req.json();
  const { externalUserId, ...updates } = body;
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  let workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (updates.name !== undefined) workflow.name = updates.name;
  if (updates.description !== undefined)
    workflow.description = updates.description;

  if (updates.steps !== undefined) {
    const oldTrigger = workflow.steps[0]?.data;
    const newTrigger = updates.steps[0]?.data;
    const triggerChanged = !isEqual(oldTrigger, newTrigger);

    if (workflow.status === 'published' && triggerChanged) {
      const pd = createPipedreamClient(c.env);
      workflow = await unpublishWorkflow(pd, db, workflow.id, externalUserId);
    }

    workflow.steps = invalidateStaleSnapshots(workflow.steps, updates.steps);

    // Validate configured prop types for every Pipedream step.
    const propErrors: string[] = [];
    for (const step of updates.steps) {
      const d = step.data as {
        source?: string;
        configuredProps?: Record<string, unknown>;
        component?: { configurableProps?: Array<{ name: string; type?: string }> };
      }
      if (!d || d.source !== 'pipedream' || !d.configuredProps || !d.component?.configurableProps) {
        continue;
      }
      const result = validatePropTypes(d.configuredProps, d.component.configurableProps);
      if (!result.valid) {
        propErrors.push(`Step "${step.id}": ${result.message}`);
      }
    }
    if (propErrors.length > 0) {
      return c.json({ error: propErrors.join('\n\n') }, 400);
    }
  }

  workflow.updatedAt = new Date().toISOString();
  await saveWorkflow(db, workflow);
  return c.json({ workflow });
});

// Delete workflow
workflows.delete('/:id', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (workflow.status === 'published') {
    const pd = createPipedreamClient(c.env);
    await unpublishWorkflow(pd, db, workflow.id, externalUserId);
  }

  await deleteWorkflow(db, workflow.id);
  return new Response(null, { status: 204 });
});

// List captured trigger events for a workflow (from our DB)
workflows.get('/:id/trigger-events', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const events = await listTriggerEvents(db, workflow.id);
  return c.json({ events });
});

// Publish workflow
workflows.post('/:id/publish', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const db = createDb(c.env.DB);
    const workflow = await publishWorkflow(
      pd,
      db,
      c.env,
      c.req.param('id'),
      externalUserId,
    );
    return c.json({ workflow });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// Test-run the workflow using a previously captured trigger event.
// No publish guard — works for both draft and published workflows.
workflows.post('/:id/trigger', async (c) => {
  const { externalUserId, eventId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }
  if (!eventId) {
    return c.json({ error: 'eventId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const triggerEvent = await getTriggerEvent(db, eventId, workflow.id);
    if (!triggerEvent) {
      return c.json({ error: 'Trigger event not found' }, 404);
    }

    const pd = createPipedreamClient(c.env);
    const run = await executeWorkflow(pd, db, workflow, triggerEvent.event, 'test');
    return c.json({ run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// Unpublish workflow
workflows.post('/:id/unpublish', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const db = createDb(c.env.DB);
    const workflow = await unpublishWorkflow(
      pd,
      db,
      c.req.param('id'),
      externalUserId,
    );
    return c.json({ workflow });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// Capture a new trigger event: temp-deploys the trigger with emitOnDeploy,
// polls until an event is received (up to timeoutMs), persists it to trigger_events,
// and updates the trigger step snapshot for step-by-step testing.
workflows.post('/:id/capture-event', async (c) => {
  const { externalUserId, timeoutMs = 60_000 } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const triggerStep = workflow.steps[0];
  if (!triggerStep?.data) {
    return c.json({ error: 'Trigger is not configured yet' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const { event } = await captureEvent(pd, c.env, workflow, externalUserId, timeoutMs);

    const triggerKey = triggerStep.data.source === 'pipedream'
      ? (triggerStep.data as PipedreamStep).component.key ?? 'unknown'
      : (triggerStep.data as { customTriggerId: string }).customTriggerId;

    const stored = await appendTriggerEvent(db, workflow.id, triggerKey, event);

    // Keep the trigger step snapshot current for step-by-step testing.
    triggerStep.outputSnapshot = { $return_value: event, exports: {} };
    triggerStep.snapshotStale = false;
    triggerStep.tested = true;
    workflow.updatedAt = new Date().toISOString();
    await saveWorkflow(db, workflow);

    return c.json({ event: stored });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// Test a single action step using stored snapshots for interpolation context
workflows.post('/:id/steps/:stepId/test', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const pd = createPipedreamClient(c.env);
  const result = await testStep(pd, db, workflow, c.req.param('stepId'));
  return c.json(result);
});

// List execution runs for a workflow
workflows.get('/:id/runs', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const runs = await listExecutionRuns(db, workflow.id, limit);
  return c.json({ runs });
});

// Get a single execution run
workflows.get('/:id/runs/:runId', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const run = await getExecutionRun(db, c.req.param('runId'));
  if (!run || run.workflowId !== workflow.id) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return c.json({ run });
});

export { workflows };
