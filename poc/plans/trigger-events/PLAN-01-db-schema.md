# Phase 01 — DB Schema & Storage Layer

## New table: `trigger_events`

Add to `apps/api/src/db/schema.ts`:

```typescript
export const triggerEvents = sqliteTable('trigger_events', {
  id: text('id').primaryKey(),               // nanoid / timestamp-based
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  triggerKey: text('trigger_key').notNull(), // e.g. "gmail-new-email"
  event: text('event').notNull(),            // JSON: the raw event payload
  capturedAt: text('captured_at').notNull(), // ISO 8601
  isStale: integer('is_stale', { mode: 'boolean' }).notNull().default(false),
});
```

**Staleness rule**: when the trigger *component* changes (`triggerKey` differs
from the current trigger step's component key), existing events are marked
stale. Config-only changes (same key, different `configuredProps`) keep events
valid — the event shape is determined by the component, not its configuration.

## Migration file

Create `apps/api/migrations/0002_trigger_events.sql`:

```sql
CREATE TABLE trigger_events (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL,
  event TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_trigger_events_workflow
  ON trigger_events (workflow_id, captured_at DESC);
```

## Storage functions

Create `apps/api/src/services/trigger-event-store.ts`:

```typescript
import { eq, desc, and } from 'drizzle-orm';
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

/** List all events for a workflow, newest first. */
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
    event: JSON.parse(r.event),
    isStale: Boolean(r.isStale),
  }));
}

/** Get a single event by ID (with workflow ownership check). */
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
  return { ...row, event: JSON.parse(row.event), isStale: Boolean(row.isStale) };
}

/**
 * Append a new event and enforce the 20-event cap.
 * Also marks existing events for this workflow with a different triggerKey as stale.
 */
export async function appendTriggerEvent(
  db: Db,
  workflowId: string,
  triggerKey: string,
  event: Record<string, unknown>,
): Promise<TriggerEvent> {
  const id = `te_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const capturedAt = new Date().toISOString();

  // Mark stale: any existing event with a different triggerKey.
  await db
    .update(triggerEvents)
    .set({ isStale: true })
    .where(
      and(
        eq(triggerEvents.workflowId, workflowId),
        // SQLite: triggerKey != triggerKey — use ne() from drizzle-orm
      )
    );
  // Note: drizzle-orm sqlite doesn't have ne() on text directly in all versions.
  // Alternative: raw SQL via db.run(`UPDATE trigger_events SET is_stale = 1
  //   WHERE workflow_id = ? AND trigger_key != ?`, [workflowId, triggerKey])

  // Insert new event.
  await db.insert(triggerEvents).values({
    id,
    workflowId,
    triggerKey,
    event: JSON.stringify(event),
    capturedAt,
    isStale: false,
  });

  // Enforce cap: delete oldest events beyond 20.
  // SQLite doesn't support LIMIT in DELETE without a subquery.
  const all = await db
    .select({ id: triggerEvents.id })
    .from(triggerEvents)
    .where(eq(triggerEvents.workflowId, workflowId))
    .orderBy(desc(triggerEvents.capturedAt))
    .all();

  if (all.length > MAX_EVENTS_PER_WORKFLOW) {
    const toDelete = all.slice(MAX_EVENTS_PER_WORKFLOW).map((r) => r.id);
    for (const deleteId of toDelete) {
      await db.delete(triggerEvents).where(eq(triggerEvents.id, deleteId));
    }
  }

  return { id, workflowId, triggerKey, event, capturedAt, isStale: false };
}
```

## Notes on the `ne()` staleness update

Drizzle's sqlite driver may require a raw SQL workaround for `!= triggerKey`.
The cleanest approach is:

```typescript
await db.run(
  sql`UPDATE trigger_events SET is_stale = 1
      WHERE workflow_id = ${workflowId} AND trigger_key != ${triggerKey}`
);
```

This is isolated to `appendTriggerEvent` so it's easy to swap later.
