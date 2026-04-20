import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ── Workflows ────────────────────────────────────────────────────────────────

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('draft'),
  externalUserId: text('external_user_id').notNull(),
  deployedTriggerId: text('deployed_trigger_id'),
  customTriggerId: text('custom_trigger_id'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Each WorkflowStep is its own row; the full step `data` (app/component/configuredProps)
// plus snapshot fields are stored as JSON text — they are deeply nested and have no
// queryable subfields, so normalising further adds no benefit.
export const workflowSteps = sqliteTable('workflow_steps', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  type: text('type').notNull(), // 'trigger' | 'action'
  data: text('data'), // JSON: PipedreamStep | CustomTriggerStep | null
  outputSchema: text('output_schema'), // JSON: StepOutputSchema | null
  outputSnapshot: text('output_snapshot'), // JSON: StepSnapshot | null
  tested: integer('tested', { mode: 'boolean' }).notNull().default(false),
});

// ── Execution Runs ───────────────────────────────────────────────────────────

export const executionRuns = sqliteTable('execution_runs', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  externalUserId: text('external_user_id').notNull(),
  triggerSource: text('trigger_source').notNull(), // 'pipedream' | 'custom' | 'test'
  triggerEventId: text('trigger_event_id'),
  triggerEvent: text('trigger_event').notNull().default('{}'), // JSON
  status: text('status').notNull().default('running'), // 'running' | 'success' | 'error'
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  error: text('error'),
});

// Each ExecutionStepResult is its own row — output is JSON, everything else is scalar.
export const executionStepResults = sqliteTable('execution_step_results', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => executionRuns.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  stepId: text('step_id').notNull(),
  componentKey: text('component_key').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at').notNull(),
  status: text('status').notNull(), // 'success' | 'error'
  output: text('output'), // JSON | null
  error: text('error'),
});
