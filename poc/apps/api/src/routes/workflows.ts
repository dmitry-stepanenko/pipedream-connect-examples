import { Hono } from 'hono';
import type { ENV_VARS } from '../env-vars';
import type { Workflow } from '../models/workflow.model';
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
  getTestTriggerEvent,
} from '../services/workflow-engine';
import { createPipedreamClient } from '../utils/pipedream';

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

  const items = await listWorkflows(c.env.WORKFLOWS, externalUserId);
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

  await saveWorkflow(c.env.WORKFLOWS, workflow);
  return c.json({ workflow }, 201);
});

// List all deployed triggers for a user (must be before /:id to avoid route shadowing)
workflows.get('/deployed-triggers', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  try {
    const pd = createPipedreamClient(c.env);
    // list() defaults to emitterType:'source' — query all four types and combine
    const responses = await Promise.all(
      (['source', 'timer', 'http', 'email'] as const).map((emitterType) =>
        pd.deployedTriggers.list({ externalUserId, emitterType }),
      ),
    );
    const triggers = responses.flatMap(
      (r) => (r as { data?: unknown[] }).data ?? [],
    );
    return c.json({ triggers });
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

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
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

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (updates.name !== undefined) workflow.name = updates.name;
  if (updates.description !== undefined)
    workflow.description = updates.description;
  if (updates.steps !== undefined) workflow.steps = updates.steps;
  workflow.updatedAt = new Date().toISOString();

  await saveWorkflow(c.env.WORKFLOWS, workflow);
  return c.json({ workflow });
});

// Delete workflow
workflows.delete('/:id', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
  if (!workflow || workflow.externalUserId !== externalUserId) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (workflow.status === 'published') {
    const pd = createPipedreamClient(c.env);
    await unpublishWorkflow(pd, c.env.WORKFLOWS, workflow.id, externalUserId);
  }

  await deleteWorkflow(c.env.WORKFLOWS, workflow.id, externalUserId);
  return new Response(null, { status: 204 });
});

// List recent events emitted by the workflow's deployed trigger
workflows.get('/:id/trigger-events', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  const n = Math.min(parseInt(c.req.query('n') ?? '10', 10), 100);
  if (!externalUserId) {
    return c.json({ error: 'externalUserId required' }, 400);
  }

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
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
    const workflow = await publishWorkflow(
      pd,
      c.env.WORKFLOWS,
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

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
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

    const results = await executeWorkflow(pd, c.env.WORKFLOWS, workflow, triggerPayload);
    return c.json({ results });
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
    const workflow = await unpublishWorkflow(
      pd,
      c.env.WORKFLOWS,
      c.req.param('id'),
      externalUserId,
    );
    return c.json({ workflow });
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

  const workflow = await getWorkflow(c.env.WORKFLOWS, c.req.param('id'));
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

export { workflows };
