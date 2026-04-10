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

export interface WorkflowStep {
  id: string;
  type: 'trigger' | 'action';
  data: WorkflowStepData | null; // null = step added but not yet configured
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Ordered list: first step must be type 'trigger', rest are 'action' */
  steps: WorkflowStep[];
  createdAt: string; // ISO date string
  updatedAt: string;
}
