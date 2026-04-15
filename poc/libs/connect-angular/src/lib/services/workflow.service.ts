import { inject, Injectable, signal, computed } from '@angular/core';
import type {
  Workflow,
  WorkflowStep,
  WorkflowStepData,
  StepOutputSchema,
  PipedreamStep,
} from '../models/workflow.model';
import { PipedreamClientService } from './pipedream-client.service';
import { WorkflowApiService } from './workflow-api.service';

export interface TestStepResult {
  success: boolean;
  error: string | null;
  outputSchema: StepOutputSchema | null;
  sampleOutput: unknown;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  // ── Dependencies ──────────────────────────────────────────────────────────

  private readonly pdClient = inject(PipedreamClientService);
  private readonly api = inject(WorkflowApiService);

  // ── State ─────────────────────────────────────────────────────────────────

  private readonly _workflows = signal<Workflow[]>([]);
  private readonly _activeWorkflowId = signal<string | null>(null);
  private readonly _loading = signal(false);

  // ── Selectors ─────────────────────────────────────────────────────────────

  readonly workflows = this._workflows.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly activeWorkflow = computed(() => {
    const id = this._activeWorkflowId();
    return id ? (this._workflows().find((w) => w.id === id) ?? null) : null;
  });

  readonly activeSteps = computed(() => this.activeWorkflow()?.steps ?? []);

  // ── Load from server ──────────────────────────────────────────────────────

  async loadWorkflows(): Promise<void> {
    this._loading.set(true);
    try {
      const workflows = await this.api.listWorkflows();
      this._workflows.set(workflows);
    } catch (err) {
      console.error('Failed to load workflows:', err);
    } finally {
      this._loading.set(false);
    }
  }

  // ── Workflow CRUD ─────────────────────────────────────────────────────────

  async createWorkflow(name = 'New Workflow'): Promise<Workflow> {
    const workflow = await this.api.createWorkflow(name);
    this._workflows.update((list) => [...list, workflow]);
    this._activeWorkflowId.set(workflow.id);
    return workflow;
  }

  async updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'description'>>,
  ) {
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
    const workflow = this._workflows().find((w) => w.id === id);
    if (workflow) {
      await this.api.saveWorkflow(workflow);
    }
  }

  async deleteWorkflow(id: string) {
    this._workflows.update((list) => list.filter((w) => w.id !== id));
    if (this._activeWorkflowId() === id) {
      this._activeWorkflowId.set(null);
    }
    await this.api.deleteWorkflow(id);
  }

  setActiveWorkflow(id: string | null) {
    this._activeWorkflowId.set(id);
  }

  // ── Step management ───────────────────────────────────────────────────────

  async addStep(workflowId: string): Promise<WorkflowStep> {
    const step: WorkflowStep = {
      id: generateId(),
      type: 'action',
      data: null,
    };
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? { ...w, steps: [...w.steps, step] }
          : w,
      ),
    );
    await this.persist(workflowId);
    return step;
  }

  async removeStep(workflowId: string, stepId: string) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? { ...w, steps: w.steps.filter((s) => s.id !== stepId) }
          : w,
      ),
    );
    await this.persist(workflowId);
  }

  async configureStep(
    workflowId: string,
    stepId: string,
    data: WorkflowStepData | null,
  ) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId ? { ...s, data } : s,
              ),
            }
          : w,
      ),
    );
    await this.persist(workflowId);
  }

  async setStepOutputSchema(
    workflowId: string,
    stepId: string,
    schema: StepOutputSchema | null,
  ) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId
                  ? { ...s, outputSchema: schema, tested: true }
                  : s,
              ),
            }
          : w,
      ),
    );
    await this.persist(workflowId);
  }

  private setStepTestStatus(
    workflowId: string,
    stepId: string,
    tested: boolean,
  ) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId ? { ...s, tested } : s,
              ),
            }
          : w,
      ),
    );
  }

  // ── Step testing ──────────────────────────────────────────────────────────

  async testStep(
    workflowId: string,
    stepId: string,
  ): Promise<TestStepResult> {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    if (!workflow)
      return {
        success: false,
        error: 'Workflow not found',
        outputSchema: null,
        sampleOutput: null,
      };

    const step = workflow.steps.find((s) => s.id === stepId);
    if (!step?.data || step.data.source !== 'pipedream') {
      return {
        success: false,
        error: 'Step must be configured before it can be tested.',
        outputSchema: null,
        sampleOutput: null,
      };
    }

    const pdStep = step.data as PipedreamStep;
    const componentKey = pdStep.component.key;
    if (!componentKey) {
      return {
        success: false,
        error: 'Component has no key',
        outputSchema: null,
        sampleOutput: null,
      };
    }

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
      await this.setStepOutputSchema(workflowId, stepId, schema);
      return {
        success: true,
        error: null,
        outputSchema: schema,
        sampleOutput: returnValue,
      };
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
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>,
    )) {
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

  // ── Reorder ───────────────────────────────────────────────────────────────

  async reorderSteps(
    workflowId: string,
    previousIndex: number,
    currentIndex: number,
  ) {
    this._workflows.update((list) =>
      list.map((w) => {
        if (w.id !== workflowId) return w;
        const steps = [...w.steps];
        const [moved] = steps.splice(previousIndex, 1);
        steps.splice(currentIndex, 0, moved);
        const retyped = steps.map((s, i) => ({
          ...s,
          type: (i === 0 ? 'trigger' : 'action') as 'trigger' | 'action',
        }));
        return { ...w, steps: retyped };
      }),
    );
    await this.persist(workflowId);
  }

  // ── Publish / Unpublish ───────────────────────────────────────────────────

  async publishWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.api.publishWorkflow(id);
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? workflow : w)),
    );
    return workflow;
  }

  async emitTestEvent(id: string): Promise<{ event: unknown }> {
    return this.api.emitTestEvent(id);
  }

  async listDeployedTriggers(): Promise<{ triggers: unknown[] }> {
    return this.api.listDeployedTriggers();
  }

  async triggerWorkflow(id: string): Promise<{ results: unknown[] }> {
    return this.api.triggerWorkflow(id);
  }

  async unpublishWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.api.unpublishWorkflow(id);
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? workflow : w)),
    );
    return workflow;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persist(workflowId: string) {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    if (workflow) {
      try {
        await this.api.saveWorkflow(workflow);
      } catch (err) {
        console.error('Failed to save workflow:', err);
      }
    }
  }
}
