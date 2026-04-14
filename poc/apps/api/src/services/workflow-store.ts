import type { Workflow } from '../models/workflow.model';

// KV key patterns:
//   wf:{workflowId}                          → Workflow JSON
//   user:{externalUserId}                    → string[] of workflow IDs
//   ct:{customTriggerId}:{externalUserId}    → string[] of workflow IDs

export async function listWorkflows(
  kv: KVNamespace,
  externalUserId: string,
): Promise<Workflow[]> {
  const idsJson = await kv.get(`user:${externalUserId}`);
  if (!idsJson) return [];

  const ids: string[] = JSON.parse(idsJson);
  const workflows = await Promise.all(ids.map((id) => getWorkflow(kv, id)));
  return workflows.filter((w): w is Workflow => w !== null);
}

export async function getWorkflow(
  kv: KVNamespace,
  workflowId: string,
): Promise<Workflow | null> {
  const json = await kv.get(`wf:${workflowId}`);
  return json ? JSON.parse(json) : null;
}

export async function saveWorkflow(
  kv: KVNamespace,
  workflow: Workflow,
): Promise<void> {
  await kv.put(`wf:${workflow.id}`, JSON.stringify(workflow));

  // Update user index
  const idsJson = await kv.get(`user:${workflow.externalUserId}`);
  const ids: string[] = idsJson ? JSON.parse(idsJson) : [];
  if (!ids.includes(workflow.id)) {
    ids.push(workflow.id);
    await kv.put(`user:${workflow.externalUserId}`, JSON.stringify(ids));
  }
}

export async function deleteWorkflow(
  kv: KVNamespace,
  workflowId: string,
  externalUserId: string,
): Promise<void> {
  await kv.delete(`wf:${workflowId}`);

  const idsJson = await kv.get(`user:${externalUserId}`);
  if (idsJson) {
    const ids: string[] = JSON.parse(idsJson);
    const filtered = ids.filter((id) => id !== workflowId);
    await kv.put(`user:${externalUserId}`, JSON.stringify(filtered));
  }
}

// ── Custom trigger index ────────────────────────────────────────────────────

export async function getWorkflowsByCustomTrigger(
  kv: KVNamespace,
  customTriggerId: string,
  externalUserId: string,
): Promise<string[]> {
  const json = await kv.get(`ct:${customTriggerId}:${externalUserId}`);
  return json ? JSON.parse(json) : [];
}

export async function indexCustomTrigger(
  kv: KVNamespace,
  customTriggerId: string,
  externalUserId: string,
  workflowId: string,
): Promise<void> {
  const ids = await getWorkflowsByCustomTrigger(
    kv,
    customTriggerId,
    externalUserId,
  );
  if (!ids.includes(workflowId)) {
    ids.push(workflowId);
    await kv.put(
      `ct:${customTriggerId}:${externalUserId}`,
      JSON.stringify(ids),
    );
  }
}

export async function removeCustomTriggerIndex(
  kv: KVNamespace,
  customTriggerId: string,
  externalUserId: string,
  workflowId: string,
): Promise<void> {
  const ids = await getWorkflowsByCustomTrigger(
    kv,
    customTriggerId,
    externalUserId,
  );
  const filtered = ids.filter((id) => id !== workflowId);
  if (filtered.length > 0) {
    await kv.put(
      `ct:${customTriggerId}:${externalUserId}`,
      JSON.stringify(filtered),
    );
  } else {
    await kv.delete(`ct:${customTriggerId}:${externalUserId}`);
  }
}
