import type {
  App,
  Component as PdComponent,
  ConfiguredProps,
} from '@pipedream/sdk';

// ── Step types (mirrors frontend model) ─────────────────────────────────────

export interface PipedreamStep {
  source: 'pipedream';
  app: App;
  component: PdComponent;
  configuredProps: ConfiguredProps;
}

export interface CustomTriggerStep {
  source: 'custom';
  customTriggerId: string;
}

export type WorkflowStepData = PipedreamStep | CustomTriggerStep;

export interface StepOutputSchema {
  [key: string]:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | 'unknown';
}

export interface StepSnapshot {
  $return_value: unknown;
  exports: Record<string, unknown>;
}

export interface WorkflowStep {
  id: string;
  type: 'trigger' | 'action';
  data: WorkflowStepData | null;
  outputSchema?: StepOutputSchema | null;
  outputSnapshot?: StepSnapshot | null;
  /** True when the step config changed after the last test run — snapshot shape may be outdated */
  snapshotStale?: boolean;
  tested?: boolean;
}

// ── Workflow ─────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'draft' | 'published' | 'error';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  externalUserId: string;
  /** Pipedream deployed trigger ID (dc_xxx), set when published */
  deployedTriggerId?: string;
  /** Custom trigger ID from step[0], indexed for lookup */
  customTriggerId?: string;
  /** Last execution error */
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
