# PLAN-05 — Workflow Data Model & WorkflowService

## Goal

Define the workflow data model and implement `WorkflowService` — a signal-based Angular service that manages workflows in memory and persists them to `localStorage`. No backend persistence for the demo.

## Context

- Library path: `poc/libs/connect-angular/src/lib/`
- Depends on core models from PLAN-02 (`CustomTrigger`)
- Angular 21 — signals only (`signal`, `computed`), no RxJS
- `localStorage` key: `pd_workflows`

## Prerequisites

PLAN-02 must be completed.

---

## Step 1 — Define data models

Create `poc/libs/connect-angular/src/lib/models/workflow.model.ts`:

```typescript
import { App, Component as PdComponent, ConfiguredProps } from '@pipedream/sdk';

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
```

---

## Step 2 — Implement `WorkflowService`

Create `poc/libs/connect-angular/src/lib/services/workflow.service.ts`:

```typescript
import { Injectable, signal, computed } from '@angular/core';
import { Workflow, WorkflowStep, WorkflowStepData } from '../models/workflow.model';

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

  addStep(workflowId: string) {
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
```

---

## Step 3 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
// Models
export {
  Workflow,
  WorkflowStep,
  WorkflowStepData,
  PipedreamStep,
  CustomTriggerStep,
} from './lib/models/workflow.model';

// Services
export { WorkflowService } from './lib/services/workflow.service';
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/libs/connect-angular/src/lib/models/workflow.model.ts` | Create |
| `poc/libs/connect-angular/src/lib/services/workflow.service.ts` | Create |
| `poc/libs/connect-angular/src/index.ts` | Append exports |

## Notes

- `WorkflowService` is `providedIn: 'root'` — shared across the whole app
- The first step (`steps[0]`) is always the trigger; `reorderSteps` enforces this by re-typing steps after reorder
- `localStorage` serialization stores `App` and `PdComponent` objects in full — they are plain JSON objects from the SDK, so `JSON.stringify`/`parse` is safe
- For a real app, replace `persist()` / `loadFromStorage()` with HTTP calls to a backend
- The `configuredProps` in `PipedreamStep` is typed as `ConfiguredProps` from `@pipedream/sdk`, which is `Record<string, unknown>` — it serializes cleanly to JSON
