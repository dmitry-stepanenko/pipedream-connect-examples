import { Hono } from 'hono';
import type { ENV_VARS } from '../env-vars';
import type { Workflow } from '../models/workflow.model';
import {
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
  getWorkflowsByDeployedTriggerIds,
} from '../services/workflow-store';
import {
  publishWorkflow,
  unpublishWorkflow,
  executeWorkflow,
  getTestTriggerEvent,
  testStep,
} from '../services/workflow-engine';
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

// List all deployed triggers for a user (must be before /:id to avoid route shadowing)
workflows.get('/deployed-triggers', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  try {
    const db = createDb(c.env.DB);
    const pd = createPipedreamClient(c.env);

    const responses = await Promise.all(
      (['source', 'timer', 'http', 'email'] as const).map((emitterType) =>
        pd.deployedTriggers.list({ externalUserId, emitterType }),
      ),
    );

    const triggerIds = responses
      .flatMap((r) => (r as { data?: unknown[] }).data ?? [])
      .map((t) => (t as Record<string, unknown>)['id'] as string)
      .filter(Boolean);

    const matchedWorkflows = await getWorkflowsByDeployedTriggerIds(db, triggerIds);

    const workflowByTriggerId = Object.fromEntries(
      matchedWorkflows.map((w) => [w.deployedTriggerId, { id: w.id, name: w.name }]),
    );

    const triggers = responses
      .flatMap((r) => (r as { data?: unknown[] }).data ?? [])
      .map((t) => {
        const trigger = t as Record<string, unknown>;
        const workflow = workflowByTriggerId[trigger['id'] as string];
        return workflow ? { ...trigger, workflow } : trigger;
      });

    return c.json({ triggers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// List recent events for a specific deployed trigger
workflows.get('/deployed-triggers/:triggerId/events', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  const n = Math.min(parseInt(c.req.query('n') ?? '20', 10), 100);
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const res = await pd.deployedTriggers.listEvents(c.req.param('triggerId'), {
      externalUserId,
      n,
    });
    return c.json({ events: (res as any).data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
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

    workflow.steps = updates.steps;
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

// List recent events emitted by the workflow's deployed trigger
workflows.get('/:id/trigger-events', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  const n = Math.min(parseInt(c.req.query('n') ?? '10', 10), 100);
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (!workflow.deployedTriggerId) {
    return c.json({ events: [] });
  }

  try {
    const pd = createPipedreamClient(c.env);
    const res = await pd.deployedTriggers.listEvents(workflow.deployedTriggerId, {
      externalUserId,
      n,
    });
    return c.json({ events: (res as { data?: unknown[] }).data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
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

// Test-trigger workflow — uses the last real event emitted by the deployed trigger
workflows.post('/:id/trigger', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const pd = createPipedreamClient(c.env);

    // Resolve the trigger payload — synthetic for schedule triggers, otherwise
    // the last real event from the deployed trigger.
    const triggerPayload =
      (await getTestTriggerEvent(pd, workflow, externalUserId)) ?? {};
    console.log(JSON.stringify({ triggerPayload }, null, 2));

    const run = await executeWorkflow(pd, db, workflow, triggerPayload, 'test');
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

// Return a sample trigger event snapshot for the workflow's trigger step.
// Works without publishing: schedule triggers get a synthetic event from their
// configured props; other trigger types require a deployedTriggerId (published workflow).
workflows.post('/:id/trigger-snapshot', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const event = await getTestTriggerEvent(pd, workflow, externalUserId);
    if (!event) {
      return c.json({ error: 'No sample event available — publish the workflow and let the trigger fire first.' }, 400);
    }
    return c.json({ snapshot: { $return_value: event, exports: {} } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// Generate a test event for the workflow's deployed trigger (mirrors Pipedream's
// "Generate Test Event" button) and return the emitted payload.
workflows.post('/:id/emit-test-event', async (c) => {
  const { externalUserId } = await c.req.json();
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const db = createDb(c.env.DB);
  const workflow = await getWorkflow(db, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (workflow.status !== 'published') {
    return c.json({ error: 'Workflow must be published before generating a test event' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    const event = await getTestTriggerEvent(pd, workflow, externalUserId);
    return c.json({ event });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
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
