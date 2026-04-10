import { Injectable, signal, computed } from '@angular/core';
import type { Workflow, WorkflowStep, WorkflowStepData } from '../models/workflow.model';

const STORAGE_KEY = 'pd_workflows';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  // ── State ──────────────────────────────────────────────────────────────────

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
    this.persist();
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
  configureStep(workflowId: string, stepId: string, data: WorkflowStepData) {
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
