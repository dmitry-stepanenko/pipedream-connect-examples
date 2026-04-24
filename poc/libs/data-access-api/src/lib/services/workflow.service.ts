import { inject, Injectable, signal, computed } from '@angular/core';
import type {
  Workflow,
  WorkflowStep,
  WorkflowStepData,
  StepOutputSchema,
  StepSnapshot,
  TriggerEvent,
} from '../workflow.model';
import { WorkflowApiService } from './workflow-api.service';

export interface TestStepResult {
  success: boolean;
  error: string | null;
  outputSnapshot: StepSnapshot | null;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  // ── Dependencies ──────────────────────────────────────────────────────────

  private readonly api = inject(WorkflowApiService);

  // ── State ─────────────────────────────────────────────────────────────────

  private readonly _workflows = signal<Workflow[]>([]);
  private readonly _activeWorkflowId = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _dirty = signal(false);
  readonly triggerEvents = signal<TriggerEvent[]>([]);

  // ── Selectors ─────────────────────────────────────────────────────────────

  readonly workflows = this._workflows.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly dirty = this._dirty.asReadonly();

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
      this._dirty.set(false);
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

  updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'description'>>,
  ) {
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
    this._dirty.set(true);
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
    this._dirty.set(false);
  }

  // ── Step management ───────────────────────────────────────────────────────

  addStep(workflowId: string, afterStepId?: string): WorkflowStep {
    const step: WorkflowStep = {
      id: generateId(),
      type: 'action',
      data: null,
    };
    this._workflows.update((list) =>
      list.map((w) => {
        if (w.id !== workflowId) return w;
        if (!afterStepId) return { ...w, steps: [...w.steps, step] };
        const idx = w.steps.findIndex((s) => s.id === afterStepId);
        if (idx < 0) return { ...w, steps: [...w.steps, step] };
        const steps = [...w.steps];
        steps.splice(idx + 1, 0, step);
        return { ...w, steps };
      }),
    );
    this._dirty.set(true);
    return step;
  }

  removeStep(workflowId: string, stepId: string) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? { ...w, steps: w.steps.filter((s) => s.id !== stepId) }
          : w,
      ),
    );
    this._dirty.set(true);
  }

  configureStep(
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
    this._dirty.set(true);
  }

  setStepOutputSchema(
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
    this._dirty.set(true);
  }

  setStepSnapshot(
    workflowId: string,
    stepId: string,
    snapshot: StepSnapshot | null,
  ) {
    this._workflows.update((list) =>
      list.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map((s) =>
                s.id === stepId
                  ? { ...s, outputSnapshot: snapshot, tested: true }
                  : s,
              ),
            }
          : w,
      ),
    );
    this._dirty.set(true);
  }

  // ── Step testing ──────────────────────────────────────────────────────────

  async testStep(
    workflowId: string,
    stepId: string,
  ): Promise<TestStepResult> {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    if (!workflow)
      return { success: false, error: 'Workflow not found', outputSnapshot: null };

    const stepIndex = workflow.steps.findIndex((s) => s.id === stepId);

    if (stepIndex === 0) {
      return {
        success: false,
        error:
          'Trigger steps cannot be run directly — they fire on their own. ' +
          'The trigger is automatically marked as ready when configured. ' +
          'Proceed to testing the next action step.',
        outputSnapshot: null,
      };
    }

    try {
      const result = await this.api.testStep(workflowId, stepId);
      if (result.success && result.outputSnapshot) {
        this.setStepSnapshot(workflowId, stepId, result.outputSnapshot);
      }
      return result;
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        outputSnapshot: null,
      };
    }
  }

  // ── Reorder ───────────────────────────────────────────────────────────────

  async reorderSteps(
    workflowId: string,
    previousIndex: number,
    currentIndex: number,
  ) {
    // Trigger is always index 0 and cannot be moved or displaced
    if (previousIndex === 0 || currentIndex === 0) return;

    this._workflows.update((list) =>
      list.map((w) => {
        if (w.id !== workflowId) return w;
        const steps = [...w.steps];
        const [moved] = steps.splice(previousIndex, 1);
        steps.splice(currentIndex, 0, moved);
        return { ...w, steps };
      }),
    );
    this._dirty.set(true);
  }

  // ── Publish / Unpublish ───────────────────────────────────────────────────

  async publishWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.api.publishWorkflow(id);
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? workflow : w)),
    );
    return workflow;
  }

  setActiveTriggerEvent(workflowId: string, event: TriggerEvent): void {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    const triggerStep = workflow?.steps[0];
    if (!triggerStep) return;
    this.setStepSnapshot(workflowId, triggerStep.id, {
      $return_value: event.event,
      exports: {},
    });
  }

  async captureEvent(
    workflowId: string,
    timeoutMs: number,
  ): Promise<{ success: boolean; event: TriggerEvent | null; error: string | null }> {
    try {
      const { event } = await this.api.captureEvent(workflowId, timeoutMs);
      // Patch trigger step snapshot with the captured event payload
      const workflow = this._workflows().find((w) => w.id === workflowId);
      const triggerStep = workflow?.steps[0];
      if (triggerStep) {
        const snapshot: StepSnapshot = {
          $return_value: event.event,
          exports: {},
        };
        this.setStepSnapshot(workflowId, triggerStep.id, snapshot);
      }
      // Prepend to local event list
      this.triggerEvents.update((evts) => [event, ...evts]);
      return { success: true, event, error: null };
    } catch (err: unknown) {
      return {
        success: false,
        event: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async loadTriggerEvents(workflowId: string): Promise<void> {
    try {
      const { events } = await this.api.listTriggerEvents(workflowId);
      this.triggerEvents.set(events);
    } catch (err) {
      console.error('Failed to load trigger events:', err);
    }
  }

  async testRun(
    workflowId: string,
    eventId: string,
  ): Promise<{ run: unknown }> {
    return this.api.testRun(workflowId, eventId);
  }

  async listDeployedTriggers(): Promise<{ triggers: unknown[] }> {
    return this.api.listDeployedTriggers();
  }

  async getDeployedTriggerEvents(triggerId: string): Promise<{ events: unknown[] }> {
    return this.api.getDeployedTriggerEvents(triggerId);
  }

  async listRuns(id: string, limit = 20): Promise<{ runs: unknown[] }> {
    return this.api.listRuns(id, limit);
  }

  async unpublishWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.api.unpublishWorkflow(id);
    this._workflows.update((list) =>
      list.map((w) => (w.id === id ? workflow : w)),
    );
    return workflow;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async save(workflowId: string): Promise<void> {
    const workflow = this._workflows().find((w) => w.id === workflowId);
    if (workflow) {
      const updated = await this.api.saveWorkflow(workflow);
      this._workflows.update((list) => list.map((w) => (w.id === workflowId ? updated : w)));
      this._dirty.set(false);
    }
  }

  async revert(workflowId: string): Promise<void> {
    const workflow = await this.api.getWorkflow(workflowId);
    this._workflows.update((list) =>
      list.map((w) => (w.id === workflowId ? workflow : w)),
    );
    this._dirty.set(false);
  }
}
