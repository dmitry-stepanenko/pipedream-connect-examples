import { eq, desc, and, ne } from 'drizzle-orm';
import type { Db } from '../db';
import { triggerEvents } from '../db/schema';

const MAX_EVENTS_PER_WORKFLOW = 20;

export interface TriggerEvent {
  id: string;
  workflowId: string;
  triggerKey: string;
  event: Record<string, unknown>;
  capturedAt: string;
  isStale: boolean;
}

/** List all captured events for a workflow, newest first. */
export async function listTriggerEvents(
  db: Db,
  workflowId: string,
): Promise<TriggerEvent[]> {
  const rows = await db
    .select()
    .from(triggerEvents)
    .where(eq(triggerEvents.workflowId, workflowId))
    .orderBy(desc(triggerEvents.capturedAt))
    .all();

  return rows.map((r) => ({
    ...r,
    event: JSON.parse(r.event) as Record<string, unknown>,
    isStale: Boolean(r.isStale),
  }));
}

/** Get a single event by ID, scoped to a workflow. */
export async function getTriggerEvent(
  db: Db,
  id: string,
  workflowId: string,
): Promise<TriggerEvent | null> {
  const row = await db
    .select()
    .from(triggerEvents)
    .where(and(eq(triggerEvents.id, id), eq(triggerEvents.workflowId, workflowId)))
    .get();

  if (!row) return null;
  return {
    ...row,
    event: JSON.parse(row.event) as Record<string, unknown>,
    isStale: Boolean(row.isStale),
  };
}

/**
 * Append a new captured event for a workflow trigger.
 *
 * - Marks any existing events with a *different* triggerKey as stale (the
 *   trigger component changed, so their event shape may no longer match).
 * - Inserts the new event.
 * - Enforces a hard cap of MAX_EVENTS_PER_WORKFLOW (oldest are deleted).
 */
export async function appendTriggerEvent(
  db: Db,
  workflowId: string,
  triggerKey: string,
  event: Record<string, unknown>,
): Promise<TriggerEvent> {
  const id = `te_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const capturedAt = new Date().toISOString();

  // Mark stale: events from a different trigger component in this workflow.
  await db
    .update(triggerEvents)
    .set({ isStale: true })
    .where(
      and(
        eq(triggerEvents.workflowId, workflowId),
        ne(triggerEvents.triggerKey, triggerKey),
      ),
    );

  // Insert the new event.
  await db.insert(triggerEvents).values({
    id,
    workflowId,
    triggerKey,
    event: JSON.stringify(event),
    capturedAt,
    isStale: false,
  });

  // Enforce cap: delete oldest events beyond the limit.
  // SQLite doesn't support LIMIT in DELETE, so we fetch IDs then delete.
  const all = await db
    .select({ id: triggerEvents.id })
    .from(triggerEvents)
    .where(eq(triggerEvents.workflowId, workflowId))
    .orderBy(desc(triggerEvents.capturedAt))
    .all();

  if (all.length > MAX_EVENTS_PER_WORKFLOW) {
    const idsToDelete = all.slice(MAX_EVENTS_PER_WORKFLOW).map((r) => r.id);
    for (const deleteId of idsToDelete) {
      await db
        .delete(triggerEvents)
        .where(
          and(
            eq(triggerEvents.id, deleteId),
            eq(triggerEvents.workflowId, workflowId),
          ),
        );
    }
  }

  return { id, workflowId, triggerKey, event, capturedAt, isStale: false };
}
