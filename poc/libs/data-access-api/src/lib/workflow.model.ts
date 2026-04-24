import type { App, Component as PdComponent, ConfiguredProps } from '@pipedream/sdk';

// ── Step ──────────────────────────────────────────────────────────────────────

/**
 * A step backed by a Pipedream app+component.
 * e.g. "Send Slack message" using the slack_v2-send-message-to-channel component.
 */
export interface PipedreamStep {
  source: 'pipedream';
  app: App;
  component: PdComponent;
  configuredProps: ConfiguredProps;
}

/**
 * A step backed by one of your internal business events.
 * e.g. "Order Created" — only valid as the first step (trigger).
 */
export interface CustomTriggerStep {
  source: 'custom';
  customTriggerId: string;
}

export type WorkflowStepData = PipedreamStep | CustomTriggerStep;

/**
 * Inferred schema describing the shape of a step's output ($return_value).
 * Built by inspecting the actual return value after a test run.
 */
export interface StepOutputSchema {
  [key: string]: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'unknown';
}

/**
 * Actual output captured from the last successful test run of a step.
 * Stored verbatim so downstream steps and the reference validator have
 * real path shapes to work with.
 */
export interface StepSnapshot {
  $return_value: unknown;
  exports: Record<string, unknown>;
}

export interface WorkflowStep {
  id: string;
  type: 'trigger' | 'action';
  data: WorkflowStepData | null; // null = step added but not yet configured
  /** Schema inferred from the last successful test run (used for triggers) */
  outputSchema?: StepOutputSchema | null;
  /** Actual output from the last successful test run (action steps) */
  outputSnapshot?: StepSnapshot | null;
  /** Whether this step has been tested at least once */
  tested?: boolean;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'draft' | 'published' | 'error';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Ordered list: first step must be type 'trigger', rest are 'action' */
  steps: WorkflowStep[];
  status: WorkflowStatus;
  externalUserId: string;
  /** Pipedream deployed trigger ID (dc_xxx), set when published */
  deployedTriggerId?: string;
  /** Custom trigger ID from step[0], indexed for lookup */
  customTriggerId?: string;
  /** Last execution error */
  lastError?: string;
  createdAt: string; // ISO date string
  updatedAt: string;
}

// ── Trigger Events ────────────────────────────────────────────────────────────

/** A captured sample event from a workflow's trigger. */
export interface TriggerEvent {
  id: string;
  workflowId: string;
  /** Pipedream component key, e.g. "gmail-new-email". Stable across republishing. */
  triggerKey: string;
  /** The raw event payload. */
  event: Record<string, unknown>;
  capturedAt: string; // ISO 8601
  /** True when captured from a different trigger component than the current one. */
  isStale: boolean;
}
