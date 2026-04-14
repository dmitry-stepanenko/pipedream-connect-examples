import { inject, Injectable, signal, computed } from '@angular/core';
import type { Workflow, WorkflowStep, WorkflowStepData, StepOutputSchema, PipedreamStep } from '../models/workflow.model';
import { PipedreamClientService } from './pipedream-client.service';

const STORAGE_KEY = 'pd_workflows';

export interface TestStepResult {
  success: boolean;
  error: string | null;
  outputSchema: StepOutputSchema | null;
  sampleOutput: unknown;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  // ── State ──────────────────────────────────────────────────────────────────

  private readonly pdClient = inject(PipedreamClientService);
  private readonly _workflows = signal<Workflow[]>(this.loadFromStorage());
  private readonly _activeWorkflowId = signal<string | null>(null);

  // ── Selectors ─────────────────────────────────────────────────────────────

  readonly workflows = this._workflows.asReadonly();

  readonly activeWorkflow = computed(() => {
    const id = this._activeWorkflowId();
    return id ? (this._workflows().find((w) => w.id === id) ?? null) : null;
  });

  readonly activeSteps = computed(() => this.activeWorkflow()?.steps ?? []);

  // ── Workflow CRUD ─────────────────────────────────────────────────────────

  createWorkflow(name = 'New Workflow'): Workflow {
    const workflow: Workflow = {
      id: generateId(),
      name,
      description: '',
      steps: [{ id: generateId(), type: 'trigger', data: null }],
      createdAt: now(),
      updatedAt: now(),
    };
    this._workflows.update((list) => [...list, workflow]);
    this._activeWorkflowId.set(workflow.id);
    // Don't persist yet — empty workflows with only a blank trigger
    // are written to storage once a step gets configured, a step is
    // added, or the workflow is renamed.
    return workflow;
  }

  updateWorkflow(id: string, patch: Partial<Pick<Workflow, 'name' | 'description'>>) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === id ? { ...w, ...patch, updatedAt: now() } : w
      )
    );
    this.persist();
  }

  deleteWorkflow(id: string) {
    this._workflows.update((list) => list.filter((w) => w.id !== id));
    if (this._activeWorkflowId() === id) {
      this._activeWorkflowId.set(null);
    }
    this.persist();
  }

  setActiveWorkflow(id: string | null) {
    this._activeWorkflowId.set(id);
  }

  // ── Step management ───────────────────────────────────────────────────────

  addStep(workflowId: string): WorkflowStep {
    const step: WorkflowStep = {
      id: generateId(),
      type: 'action',
      data: null,
    };
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? { ...w, steps: [...w.steps, step], updatedAt: now() }
          : w
      )
    );
    this.persist();
    return step;
  }

  removeStep(workflowId: string, stepId: string) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.filter((s) => s.id !== stepId),
              updatedAt: now(),
            }
          : w
      )
    );
    this.persist();
  }

  /**
   * Update the data for a specific step (app, component, configuredProps or customTriggerId).
   */
  configureStep(workflowId: string, stepId: string, data: WorkflowStepData | null) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId ? { ...s, data } : s
              ),
              updatedAt: now(),
            }
          : w
      )
    );
    this.persist();
  }

  /**
   * Store the inferred output schema for a step after a successful test run.
   */
  setStepOutputSchema(workflowId: string, stepId: string, schema: StepOutputSchema | null) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId ? { ...s, outputSchema: schema, tested: true } : s
              ),
              updatedAt: now(),
            }
          : w
      )
    );
    this.persist();
  }

  private setStepTestStatus(workflowId: string, stepId: string, tested: boolean) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId ? { ...s, tested } : s
              ),
              updatedAt: now(),
            }
          : w
      )
    );
    this.persist();
  }

  // ── Step testing ──────────────────────────────────────────────────────────

  /**
   * Execute (test) a configured Pipedream step, inspect the result, and store
   * the output schema on success. Returns a structured result for callers.
   */
  async testStep(workflowId: string, stepId: string): Promise<TestStepResult> {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    if (!workflow) return { success: false, error: 'Workflow not found', outputSchema: null, sampleOutput: null };

    const step = workflow.steps.find((s) => s.id === stepId);
    if (!step?.data || step.data.source !== 'pipedream') {
      return { success: false, error: 'Step must be configured before it can be tested.', outputSchema: null, sampleOutput: null };
    }

    const pdStep = step.data as PipedreamStep;
    const componentKey = pdStep.component.key;
    if (!componentKey) {
      return { success: false, error: 'Component has no key', outputSchema: null, sampleOutput: null };
    }

    // Reset tested status before running — a failed re-test should clear it
    this.setStepTestStatus(workflowId, stepId, false);

    try {
      const result = await this.pdClient.runAction(
        componentKey,
        pdStep.configuredProps as Record<string, unknown>,
        pdStep.component.configurableProps,
      );
      const typedResult = result as {
        ret?: unknown;
        exports?: Record<string, unknown>;
        os?: Array<{ k: string; err?: { message?: string } }>;
      };

      const execError = typedResult.os?.find((o) => o.k === 'error');
      if (execError) {
        return {
          success: false,
          error: execError.err?.message ?? 'Step execution failed',
          outputSchema: null,
          sampleOutput: null,
        };
      }

      const returnValue = typedResult.ret ?? typedResult.exports ?? null;
      const schema = this.inferSchema(returnValue);
      this.setStepOutputSchema(workflowId, stepId, schema);
      return { success: true, error: null, outputSchema: schema, sampleOutput: returnValue };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        outputSchema: null,
        sampleOutput: null,
      };
    }
  }

  private inferSchema(value: unknown): StepOutputSchema | null {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    const schema: StepOutputSchema = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === null) schema[key] = 'null';
      else if (Array.isArray(val)) schema[key] = 'array';
      else if (typeof val === 'object') schema[key] = 'object';
      else if (typeof val === 'string') schema[key] = 'string';
      else if (typeof val === 'number') schema[key] = 'number';
      else if (typeof val === 'boolean') schema[key] = 'boolean';
      else schema[key] = 'unknown';
    }
    return schema;
  }

  /**
   * Reorder steps using indices (from Angular CDK drag-drop CdkDragDrop event).
   * The trigger step (index 0) cannot be moved past index 0.
   */
  reorderSteps(workflowId: string, previousIndex: number, currentIndex: number) {
    this._workflows.update((list) =>
      list.map((w) => {
        if (w.id !== workflowId) return w;
        const steps = [...w.steps];
        const [moved] = steps.splice(previousIndex, 1);
        steps.splice(currentIndex, 0, moved);
        // Ensure first step is always marked as trigger
        const retyped = steps.map((s, i) => ({
          ...s,
          type: (i === 0 ? 'trigger' : 'action') as 'trigger' | 'action',
        }));
        return { ...w, steps: retyped, updatedAt: now() };
      })
    );
    this.persist();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._workflows()));
    } catch {
      // Ignore storage errors (e.g. private browsing quota)
    }
  }

  private loadFromStorage(): Workflow[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Workflow[]) : [];
    } catch {
      return [];
    }
  }
}
