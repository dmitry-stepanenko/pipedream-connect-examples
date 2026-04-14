import { Hono } from 'hono';
import type { ENV_VARS } from '../env-vars';
import {
  getWorkflow,
  getWorkflowsByCustomTrigger,
} from '../services/workflow-store';
import { executeWorkflow } from '../services/workflow-engine';
import { createPipedreamClient } from '../utils/pipedream';

const webhooks = new Hono<{ Bindings: ENV_VARS }>();

// Pipedream trigger webhook — receives events from deployed triggers
webhooks.post('/pipedream/:workflowId', async (c) => {
  const workflow = await getWorkflow(
    c.env.WORKFLOWS,
    c.req.param('workflowId'),
  );
  if (!workflow || workflow.status !== 'published') {
    return c.json({ error: 'Workflow not found or not published' }, 404);
  }

  const triggerPayload = await c.req.json();
  const pd = createPipedreamClient(c.env);

  // Execute in background — respond immediately
  c.executionCtx.waitUntil(
    executeWorkflow(pd, c.env.WORKFLOWS, workflow, triggerPayload)
      .then((results) =>
        console.log(`Workflow ${workflow.id} executed:`, JSON.stringify(results)),
      )
      .catch((err) =>
        console.error(`Workflow ${workflow.id} execution failed:`, err),
      ),
  );

  return c.json({ status: 'accepted' }, 202);
});

// Custom trigger webhook — receives business events from host app
webhooks.post('/custom/:customTriggerId', async (c) => {
  const customTriggerId = c.req.param('customTriggerId');
  const externalUserId = c.req.header('x-external-user-id');
  if (!externalUserId) {
    return c.json({ error: 'x-external-user-id header required' }, 400);
  }

  const workflowIds = await getWorkflowsByCustomTrigger(
    c.env.WORKFLOWS,
    customTriggerId,
    externalUserId,
  );
  if (workflowIds.length === 0) {
    return c.json({ error: 'No matching workflows' }, 404);
  }

  const triggerPayload = await c.req.json();
  const pd = createPipedreamClient(c.env);

  // Execute all matching workflows in background
  c.executionCtx.waitUntil(
    Promise.all(
      workflowIds.map(async (wfId) => {
        const workflow = await getWorkflow(c.env.WORKFLOWS, wfId);
        if (!workflow || workflow.status !== 'published') return;
        return executeWorkflow(pd, c.env.WORKFLOWS, workflow, triggerPayload);
      }),
    )
      .then(() =>
        console.log(
          `Custom trigger ${customTriggerId}: executed ${workflowIds.length} workflows`,
        ),
      )
      .catch((err) =>
        console.error(`Custom trigger ${customTriggerId} failed:`, err),
      ),
  );

  return c.json(
    { status: 'accepted', workflowCount: workflowIds.length },
    202,
  );
});

export { webhooks };
