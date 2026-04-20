import { eq, desc, inArray } from 'drizzle-orm';
import type { ExecutionRun, ExecutionStepResult } from '../models/execution-run.model';
import type { Db } from '../db';
import { executionRuns as runsTable, executionStepResults } from '../db/schema';

const MAX_RUNS_PER_WORKFLOW = 50;

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunId(): string {
  return generateRunId();
}

// ── Row → model assembly ────────────────────────────────────────────────────

function rowToRun(
  row: typeof runsTable.$inferSelect,
  steps: (typeof executionStepResults.$inferSelect)[],
): ExecutionRun {
  return {
    id: row.id,
    workflowId: row.workflowId,
    externalUserId: row.externalUserId,
    triggerSource: row.triggerSource as ExecutionRun['triggerSource'],
    triggerEventId: row.triggerEventId ?? undefined,
    triggerEvent: JSON.parse(row.triggerEvent),
    status: row.status as ExecutionRun['status'],
    steps: steps.map((s) => ({
      stepId: s.stepId,
      componentKey: s.componentKey,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      status: s.status as ExecutionStepResult['status'],
      output: s.output ? JSON.parse(s.output) : undefined,
      error: s.error ?? undefined,
    })),
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    error: row.error ?? undefined,
  };
}

// ── Store functions ─────────────────────────────────────────────────────────

export async function saveExecutionRun(
  db: Db,
  run: ExecutionRun,
): Promise<void> {
  const upsert = db
    .insert(runsTable)
    .values({
      id: run.id,
      workflowId: run.workflowId,
      externalUserId: run.externalUserId,
      triggerSource: run.triggerSource,
      triggerEventId: run.triggerEventId ?? null,
      triggerEvent: JSON.stringify(run.triggerEvent),
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? null,
      error: run.error ?? null,
    })
    .onConflictDoUpdate({
      target: runsTable.id,
      set: {
        status: run.status,
        completedAt: run.completedAt ?? null,
        error: run.error ?? null,
      },
    });

  const deleteSteps = db
    .delete(executionStepResults)
    .where(eq(executionStepResults.runId, run.id));

  if (run.steps.length === 0) {
    await db.batch([upsert, deleteSteps]);
  } else {
    const insertSteps = db.insert(executionStepResults).values(
      run.steps.map((s, i) => ({
        runId: run.id,
        stepOrder: i,
        stepId: s.stepId,
        componentKey: s.componentKey,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        status: s.status,
        output: s.output !== undefined ? JSON.stringify(s.output) : null,
        error: s.error ?? null,
      })),
    );
    await db.batch([upsert, deleteSteps, insertSteps]);
  }

  // Cap runs per workflow — runs beyond MAX_RUNS_PER_WORKFLOW are removed.
  // Done outside the transaction so the overflow check sees the committed insert.
  const allRunIds = await db
    .select({ id: runsTable.id })
    .from(runsTable)
    .where(eq(runsTable.workflowId, run.workflowId))
    .orderBy(desc(runsTable.startedAt));

  const toDelete = allRunIds.slice(MAX_RUNS_PER_WORKFLOW);
  if (toDelete.length > 0) {
    await db
      .delete(runsTable)
      .where(inArray(runsTable.id, toDelete.map((r) => r.id)));
    // execution_step_results cascade on delete
  }
}

export async function getExecutionRun(
  db: Db,
  runId: string,
): Promise<ExecutionRun | null> {
  const [row] = await db
    .select()
    .from(runsTable)
    .where(eq(runsTable.id, runId))
    .limit(1);

  if (!row) return null;

  const steps = await db
    .select()
    .from(executionStepResults)
    .where(eq(executionStepResults.runId, runId))
    .orderBy(executionStepResults.stepOrder);

  return rowToRun(row, steps);
}

export async function listExecutionRuns(
  db: Db,
  workflowId: string,
  limit = 20,
): Promise<ExecutionRun[]> {
  const runs = await db
    .select()
    .from(runsTable)
    .where(eq(runsTable.workflowId, workflowId))
    .orderBy(desc(runsTable.startedAt))
    .limit(limit);

  if (runs.length === 0) return [];

  const runIds = runs.map((r) => r.id);
  const steps = await db
    .select()
    .from(executionStepResults)
    .where(inArray(executionStepResults.runId, runIds))
    .orderBy(executionStepResults.stepOrder);

  return runs.map((r) =>
    rowToRun(
      r,
      steps.filter((s) => s.runId === r.id),
    ),
  );
}
