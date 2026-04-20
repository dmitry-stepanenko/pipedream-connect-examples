import { eq, and, inArray } from 'drizzle-orm';
import type { Workflow, WorkflowStep } from '../models/workflow.model';
import type { Db } from '../db';
import { workflows as workflowsTable, workflowSteps } from '../db/schema';

// ── Row → model assembly ────────────────────────────────────────────────────

function rowToWorkflow(
  row: typeof workflowsTable.$inferSelect,
  steps: (typeof workflowSteps.$inferSelect)[],
): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as Workflow['status'],
    externalUserId: row.externalUserId,
    deployedTriggerId: row.deployedTriggerId ?? undefined,
    customTriggerId: row.customTriggerId ?? undefined,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    steps: steps.map((s) => ({
      id: s.id,
      type: s.type as WorkflowStep['type'],
      data: s.data ? JSON.parse(s.data) : null,
      outputSchema: s.outputSchema ? JSON.parse(s.outputSchema) : null,
      outputSnapshot: s.outputSnapshot ? JSON.parse(s.outputSnapshot) : null,
      tested: s.tested,
    })),
  };
}

// ── Store functions ─────────────────────────────────────────────────────────

export async function listWorkflows(
  db: Db,
  externalUserId: string,
): Promise<Workflow[]> {
  const wfRows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.externalUserId, externalUserId));

  if (wfRows.length === 0) return [];

  const ids = wfRows.map((w) => w.id);
  const stepRows = await db
    .select()
    .from(workflowSteps)
    .where(inArray(workflowSteps.workflowId, ids))
    .orderBy(workflowSteps.stepOrder);

  return wfRows.map((w) =>
    rowToWorkflow(
      w,
      stepRows.filter((s) => s.workflowId === w.id),
    ),
  );
}

export async function getWorkflow(
  db: Db,
  workflowId: string,
): Promise<Workflow | null> {
  const [row] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);

  if (!row) return null;

  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, workflowId))
    .orderBy(workflowSteps.stepOrder);

  return rowToWorkflow(row, steps);
}

export async function saveWorkflow(db: Db, workflow: Workflow): Promise<void> {
  const upsert = db
    .insert(workflowsTable)
    .values({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      externalUserId: workflow.externalUserId,
      deployedTriggerId: workflow.deployedTriggerId ?? null,
      customTriggerId: workflow.customTriggerId ?? null,
      lastError: workflow.lastError ?? null,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })
    .onConflictDoUpdate({
      target: workflowsTable.id,
      set: {
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        deployedTriggerId: workflow.deployedTriggerId ?? null,
        customTriggerId: workflow.customTriggerId ?? null,
        lastError: workflow.lastError ?? null,
        updatedAt: workflow.updatedAt,
      },
    });

  const deleteSteps = db
    .delete(workflowSteps)
    .where(eq(workflowSteps.workflowId, workflow.id));

  if (workflow.steps.length === 0) {
    await db.batch([upsert, deleteSteps]);
    return;
  }

  const insertSteps = db.insert(workflowSteps).values(
    workflow.steps.map((step, i) => ({
      id: step.id,
      workflowId: workflow.id,
      stepOrder: i,
      type: step.type,
      data: step.data ? JSON.stringify(step.data) : null,
      outputSchema: step.outputSchema
        ? JSON.stringify(step.outputSchema)
        : null,
      outputSnapshot: step.outputSnapshot
        ? JSON.stringify(step.outputSnapshot)
        : null,
      tested: step.tested ?? false,
    })),
  );

  await db.batch([upsert, deleteSteps, insertSteps]);
}

export async function deleteWorkflow(
  db: Db,
  workflowId: string,
): Promise<void> {
  // workflow_steps and execution_runs cascade on delete
  await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
}

// ── Custom trigger lookup ───────────────────────────────────────────────────
// custom_trigger_id is now a plain column on the workflows table — no separate
// index to maintain. indexCustomTrigger / removeCustomTriggerIndex are gone;
// saveWorkflow handles the value as part of the normal upsert.

export async function getWorkflowsByDeployedTriggerIds(
  db: Db,
  triggerIds: string[],
): Promise<{ id: string; name: string; deployedTriggerId: string }[]> {
  if (triggerIds.length === 0) return [];
  const rows = await db
    .select({
      id: workflowsTable.id,
      name: workflowsTable.name,
      deployedTriggerId: workflowsTable.deployedTriggerId,
    })
    .from(workflowsTable)
    .where(inArray(workflowsTable.deployedTriggerId, triggerIds));
  return rows
    .filter((r) => r.deployedTriggerId !== null)
    .map((r) => ({ id: r.id, name: r.name, deployedTriggerId: r.deployedTriggerId! }));
}

export async function getWorkflowsByCustomTrigger(
  db: Db,
  customTriggerId: string,
  externalUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: workflowsTable.id })
    .from(workflowsTable)
    .where(
      and(
        eq(workflowsTable.customTriggerId, customTriggerId),
        eq(workflowsTable.externalUserId, externalUserId),
      ),
    );
  return rows.map((r) => r.id);
}

// kept for backward-compat but now a no-op — delete this stub once all callers are updated
/** @deprecated saveWorkflow now persists customTriggerId directly */
export async function indexCustomTrigger(): Promise<void> {}

/** @deprecated saveWorkflow now persists customTriggerId directly */
export async function removeCustomTriggerIndex(): Promise<void> {}
