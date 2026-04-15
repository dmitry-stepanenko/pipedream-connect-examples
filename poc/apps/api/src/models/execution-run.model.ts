// ── Execution Run ────────────────────────────────────────────────────────────

export type ExecutionRunStatus = 'running' | 'success' | 'error';
export type ExecutionTriggerSource = 'pipedream' | 'custom' | 'test';

export interface ExecutionStepResult {
  stepId: string;
  componentKey: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'error';
  output?: unknown;
  error?: string;
}

export interface ExecutionRun {
  id: string;
  workflowId: string;
  externalUserId: string;
  triggerSource: ExecutionTriggerSource;
  /** Pipedream event ID from deployedTriggers.listEvents (if resolved) */
  triggerEventId?: string;
  triggerEvent: unknown;
  status: ExecutionRunStatus;
  steps: ExecutionStepResult[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}
