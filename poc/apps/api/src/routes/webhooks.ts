import { Hono } from 'hono';
import { isEqual } from 'lodash-es';
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

  // Resolve the Pipedream event ID so we can correlate this execution run with
  // the event shown in the "Recent Events" list (from deployedTriggers.listEvents).
  // Pipedream's webhook POST does not include an event ID in headers or body —
  // only the raw event payload — so we fetch the latest events and match by
  // deep equality of the entire payload.
  let triggerEventId: string | undefined;
  if (workflow.deployedTriggerId) {
    try {
      const res = await pd.deployedTriggers.listEvents(workflow.deployedTriggerId, {
        externalUserId: workflow.externalUserId,
        n: 5,
      });
      const events = (res as { data?: Array<{ id?: string; e?: unknown }> }).data;
      if (events) {
        const match = events.find((ev) => isEqual(ev.e, triggerPayload));
        triggerEventId = match?.id;
      }
    } catch (err) {
      console.error('Failed to resolve trigger event ID:', err);
    }
  }

  // Execute in background — respond immediately
  c.executionCtx.waitUntil(
    executeWorkflow(pd, c.env.WORKFLOWS, workflow, triggerPayload, 'pipedream', triggerEventId)
      .then((run) =>
        console.log(`Workflow ${workflow.id} run ${run.id} completed: ${run.status}`),
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
        return executeWorkflow(pd, c.env.WORKFLOWS, workflow, triggerPayload, 'custom');
      }),
    )
      .then((runs) => {
        const completed = runs.filter(Boolean);
        console.log(
          `Custom trigger ${customTriggerId}: executed ${completed.length} workflows`,
        );
      })
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
