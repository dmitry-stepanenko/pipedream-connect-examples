import type { ExecutionRun } from '../models/execution-run.model';

// KV key patterns:
//   run:{runId}                      → ExecutionRun JSON
//   wf-runs:{workflowId}            → string[] of runIds (newest first, capped)

const MAX_RUNS_PER_WORKFLOW = 50;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunId(): string {
  return generateRunId();
}

export async function saveExecutionRun(
  kv: KVNamespace,
  run: ExecutionRun,
): Promise<void> {
  await kv.put(`run:${run.id}`, JSON.stringify(run));

  // Update workflow runs index (newest first, capped)
  const indexKey = `wf-runs:${run.workflowId}`;
  const idsJson = await kv.get(indexKey);
  const ids: string[] = idsJson ? JSON.parse(idsJson) : [];

  // Add to front if not already present
  if (!ids.includes(run.id)) {
    ids.unshift(run.id);
  }

  // Cap the index
  if (ids.length > MAX_RUNS_PER_WORKFLOW) {
    const removed = ids.splice(MAX_RUNS_PER_WORKFLOW);
    // Clean up old run records
    await Promise.all(removed.map((id) => kv.delete(`run:${id}`)));
  }

  await kv.put(indexKey, JSON.stringify(ids));
}

export async function getExecutionRun(
  kv: KVNamespace,
  runId: string,
): Promise<ExecutionRun | null> {
  const json = await kv.get(`run:${runId}`);
  return json ? JSON.parse(json) : null;
}

export async function listExecutionRuns(
  kv: KVNamespace,
  workflowId: string,
  limit = 20,
): Promise<ExecutionRun[]> {
  const indexKey = `wf-runs:${workflowId}`;
  const idsJson = await kv.get(indexKey);
  if (!idsJson) return [];

  const ids: string[] = JSON.parse(idsJson);
  const sliced = ids.slice(0, limit);

  const runs = await Promise.all(sliced.map((id) => getExecutionRun(kv, id)));
  return runs.filter((r): r is ExecutionRun => r !== null);
}
