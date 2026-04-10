# PLAN-06 — Workflow Builder UI

## Goal

Build the visual workflow graph — the main user-facing feature. Users see an ordered chain of steps, click to configure each one, and can add/remove/reorder steps.

Components to build:
- `WorkflowListComponent` — list of saved workflows, create/delete
- `WorkflowBuilderComponent` — main canvas showing the step chain
- `WorkflowStepComponent` — individual step card (collapsed + expanded states)
- `StepPickerComponent` — modal/panel for choosing trigger or action for an unconfigured step

## Context

- Library path: `poc/libs/connect-angular/src/lib/components/`
- Depends on: `WorkflowService` (PLAN-05), `AppSelectorComponent` + `ComponentSelectorComponent` (PLAN-03), `ComponentFormComponent` (PLAN-04), `CUSTOM_TRIGGERS` token (PLAN-02)
- Angular CDK drag-drop for reordering: install `@angular/cdk` if not present
- Angular 21 standalone components, signals

## Prerequisites

PLAN-02, PLAN-03, PLAN-04, PLAN-05 must be completed.

---

## Step 0 — Install Angular CDK

```bash
# From poc/
npm install @angular/cdk
```

---

## Step 1 — File structure

```
poc/libs/connect-angular/src/lib/components/
├── workflow-list/
│   ├── workflow-list.ts
│   ├── workflow-list.html
│   └── workflow-list.css
├── workflow-builder/
│   ├── workflow-builder.ts
│   ├── workflow-builder.html
│   └── workflow-builder.css
├── workflow-step/
│   ├── workflow-step.ts
│   ├── workflow-step.html
│   └── workflow-step.css
└── step-picker/
    ├── step-picker.ts
    ├── step-picker.html
    └── step-picker.css
```

---

## Step 2 — `WorkflowListComponent`

Shows all saved workflows; lets users create new ones and switch between them.

### `workflow-list.ts`

```typescript
import { Component, inject, output } from '@angular/core';
import { WorkflowService } from '../../services/workflow.service';
import { Workflow } from '../../models/workflow.model';

@Component({
  selector: 'pd-workflow-list',
  standalone: true,
  templateUrl: './workflow-list.html',
  styleUrl: './workflow-list.css',
})
export class WorkflowListComponent {
  open = output<string>(); // emits workflow id

  protected readonly workflowService = inject(WorkflowService);

  protected create() {
    const w = this.workflowService.createWorkflow();
    this.open.emit(w.id);
  }

  protected openWorkflow(id: string) {
    this.workflowService.setActiveWorkflow(id);
    this.open.emit(id);
  }

  protected delete(event: Event, id: string) {
    event.stopPropagation();
    if (confirm('Delete this workflow?')) {
      this.workflowService.deleteWorkflow(id);
    }
  }
}
```

### `workflow-list.html`

```html
<div class="pd-workflow-list">
  <div class="pd-workflow-list__header">
    <h2>Workflows</h2>
    <button type="button" class="pd-btn pd-btn--primary" (click)="create()">
      + New Workflow
    </button>
  </div>

  @if (workflowService.workflows().length === 0) {
    <p class="pd-empty-state">No workflows yet. Create one to get started.</p>
  } @else {
    <ul class="pd-workflow-items">
      @for (workflow of workflowService.workflows(); track workflow.id) {
        <li
          class="pd-workflow-item"
          [class.pd-workflow-item--active]="workflowService.activeWorkflow()?.id === workflow.id"
          (click)="openWorkflow(workflow.id)"
          (keydown.enter)="openWorkflow(workflow.id)"
          tabindex="0"
          role="button"
        >
          <div class="pd-workflow-item__info">
            <strong>{{ workflow.name }}</strong>
            <small>{{ workflow.steps.length }} step(s)</small>
          </div>
          <button
            type="button"
            class="pd-btn pd-btn--danger pd-btn--sm"
            (click)="delete($event, workflow.id)"
            aria-label="Delete workflow"
          >
            ✕
          </button>
        </li>
      }
    </ul>
  }
</div>
```

---

## Step 3 — `WorkflowBuilderComponent`

The main canvas. Shows the step chain with drag-drop reordering.

### `workflow-builder.ts`

```typescript
import { Component, inject, signal } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { WorkflowService } from '../../services/workflow.service';
import { WorkflowStep } from '../../models/workflow.model';
import { WorkflowStepComponent } from '../workflow-step/workflow-step';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'pd-workflow-builder',
  standalone: true,
  imports: [DragDropModule, WorkflowStepComponent, FormsModule],
  templateUrl: './workflow-builder.html',
  styleUrl: './workflow-builder.css',
})
export class WorkflowBuilderComponent {
  protected readonly workflowService = inject(WorkflowService);
  protected readonly editingName = signal(false);

  protected get workflow() {
    return this.workflowService.activeWorkflow();
  }

  protected addStep() {
    const w = this.workflow;
    if (w) this.workflowService.addStep(w.id);
  }

  protected removeStep(stepId: string) {
    const w = this.workflow;
    if (w) this.workflowService.removeStep(w.id, stepId);
  }

  protected onDrop(event: CdkDragDrop<WorkflowStep[]>) {
    const w = this.workflow;
    if (!w) return;
    // Prevent moving the trigger step away from position 0
    if (event.currentIndex === 0 && event.previousIndex !== 0) return;
    if (event.previousIndex === 0 && event.currentIndex !== 0) return;
    this.workflowService.reorderSteps(
      w.id,
      event.previousIndex,
      event.currentIndex
    );
  }

  protected saveName(name: string) {
    const w = this.workflow;
    if (w) this.workflowService.updateWorkflow(w.id, { name });
    this.editingName.set(false);
  }
}
```

### `workflow-builder.html`

```html
@if (!workflow) {
  <div class="pd-builder-empty">
    <p>Select or create a workflow to start building.</p>
  </div>
} @else {
  <div class="pd-workflow-builder">
    <!-- Header -->
    <div class="pd-builder-header">
      @if (editingName()) {
        <input
          #nameInput
          class="pd-workflow-name-input"
          [value]="workflow.name"
          (blur)="saveName(nameInput.value)"
          (keydown.enter)="saveName(nameInput.value)"
          (keydown.escape)="editingName.set(false)"
          autofocus
        />
      } @else {
        <h2 class="pd-workflow-name" (click)="editingName.set(true)" title="Click to rename">
          {{ workflow.name }}
        </h2>
      }
    </div>

    <!-- Step chain with drag-drop -->
    <div
      class="pd-step-chain"
      cdkDropList
      [cdkDropListData]="workflowService.activeSteps()"
      (cdkDropListDropped)="onDrop($event)"
    >
      @for (step of workflowService.activeSteps(); track step.id; let i = $index) {
        <div cdkDrag [cdkDragDisabled]="i === 0">
          <pd-workflow-step
            [step]="step"
            [workflowId]="workflow.id"
            [stepIndex]="i"
            (remove)="removeStep(step.id)"
          />
          <!-- Connector arrow between steps -->
          @if (i < workflowService.activeSteps().length - 1) {
            <div class="pd-connector" aria-hidden="true">↓</div>
          }
        </div>
      }
    </div>

    <!-- Add step button -->
    <button type="button" class="pd-add-step-btn" (click)="addStep()">
      + Add Step
    </button>
  </div>
}
```

---

## Step 4 — `WorkflowStepComponent`

Each step card toggles between a collapsed summary and an expanded config panel.

### `workflow-step.ts`

```typescript
import { Component, input, output, signal, inject, computed } from '@angular/core';
import { WorkflowStep, WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import { StepPickerComponent } from '../step-picker/step-picker';
import { ComponentFormComponent } from '../component-form/component-form';
import { ConfiguredProps } from '@pipedream/sdk';

@Component({
  selector: 'pd-workflow-step',
  standalone: true,
  imports: [StepPickerComponent, ComponentFormComponent],
  templateUrl: './workflow-step.html',
  styleUrl: './workflow-step.css',
})
export class WorkflowStepComponent {
  step = input.required<WorkflowStep>();
  workflowId = input.required<string>();
  stepIndex = input.required<number>();
  remove = output<void>();

  protected readonly expanded = signal(false);
  protected readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);

  protected readonly isPipedream = computed(
    () => this.step().data?.source === 'pipedream'
  );
  protected readonly isCustom = computed(
    () => this.step().data?.source === 'custom'
  );
  protected readonly isUnconfigured = computed(() => !this.step().data);

  protected get pipedreamData(): PipedreamStep | null {
    const d = this.step().data;
    return d?.source === 'pipedream' ? (d as PipedreamStep) : null;
  }

  protected get customData(): CustomTriggerStep | null {
    const d = this.step().data;
    return d?.source === 'custom' ? (d as CustomTriggerStep) : null;
  }

  protected get customTriggerName(): string {
    const d = this.customData;
    if (!d) return '';
    return this.customTriggers.find((t) => t.id === d.customTriggerId)?.name ?? d.customTriggerId;
  }

  protected onStepPicked(data: WorkflowStepData) {
    this.workflowService.configureStep(this.workflowId(), this.step().id, data);
    this.expanded.set(true); // open form after picking
  }

  protected onFormConfigure(configuredProps: ConfiguredProps) {
    const current = this.pipedreamData;
    if (!current) return;
    this.workflowService.configureStep(this.workflowId(), this.step().id, {
      ...current,
      configuredProps,
    });
  }
}
```

### `workflow-step.html`

```html
<div class="pd-step" [class.pd-step--expanded]="expanded()">
  <!-- Step header / summary bar -->
  <div class="pd-step-header" (click)="expanded.set(!expanded())">
    <div class="pd-step-label">
      <span class="pd-step-index">{{ stepIndex() + 1 }}</span>
      @if (isUnconfigured()) {
        <span class="pd-step-placeholder">
          {{ step().type === 'trigger' ? 'Choose a trigger' : 'Choose an action' }}
        </span>
      } @else if (isCustom()) {
        <span class="pd-step-name">{{ customTriggerName }}</span>
        <small class="pd-step-source">Custom trigger</small>
      } @else if (isPipedream()) {
        @if (pipedreamData()?.app?.img) {
          <img [src]="pipedreamData()!.app.img" class="pd-step-icon" [alt]="pipedreamData()!.app.name" />
        }
        <span class="pd-step-name">{{ pipedreamData()?.component?.name }}</span>
        <small class="pd-step-source">{{ pipedreamData()?.app?.name }}</small>
      }
    </div>

    <div class="pd-step-actions">
      <button
        type="button"
        class="pd-btn pd-btn--ghost pd-btn--sm"
        (click)="expanded.set(!expanded()); $event.stopPropagation()"
        [attr.aria-expanded]="expanded()"
      >
        {{ expanded() ? '▲' : '▼' }}
      </button>
      @if (step().type !== 'trigger' || stepIndex() > 0) {
        <button
          type="button"
          class="pd-btn pd-btn--danger pd-btn--sm"
          (click)="remove.emit(); $event.stopPropagation()"
          aria-label="Remove step"
        >
          ✕
        </button>
      }
    </div>
  </div>

  <!-- Expanded content -->
  @if (expanded()) {
    <div class="pd-step-body">
      @if (isUnconfigured()) {
        <pd-step-picker
          [stepType]="step().type"
          (picked)="onStepPicked($event)"
        />
      } @else if (isPipedream() && pipedreamData()?.component) {
        <pd-component-form
          [component]="pipedreamData()!.component"
          [configuredProps]="pipedreamData()!.configuredProps"
          (configure)="onFormConfigure($event)"
        />
      } @else if (isCustom()) {
        <p class="pd-custom-trigger-info">
          This step triggers the workflow from your internal system.
          No additional configuration required here.
        </p>
      }
    </div>
  }
</div>
```

---

## Step 5 — `StepPickerComponent`

Shown when a step has no data yet. Lets users choose between custom triggers and Pipedream apps.

### `step-picker.ts`

```typescript
import { Component, input, output, signal, inject } from '@angular/core';
import { App, Component as PdComponent } from '@pipedream/sdk';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import { WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
import { AppSelectorComponent } from '../app-selector/app-selector';
import { ComponentSelectorComponent } from '../component-selector/component-selector';

type PickerMode = 'choose-source' | 'custom' | 'pipedream-app' | 'pipedream-component';

@Component({
  selector: 'pd-step-picker',
  standalone: true,
  imports: [AppSelectorComponent, ComponentSelectorComponent],
  templateUrl: './step-picker.html',
  styleUrl: './step-picker.css',
})
export class StepPickerComponent {
  stepType = input.required<'trigger' | 'action'>();
  picked = output<WorkflowStepData>();

  protected readonly customTriggers = inject(CUSTOM_TRIGGERS);
  protected readonly mode = signal<PickerMode>('choose-source');
  protected readonly selectedApp = signal<App | null>(null);

  protected selectCustom(triggerId: string) {
    const data: CustomTriggerStep = { source: 'custom', customTriggerId: triggerId };
    this.picked.emit(data);
  }

  protected onAppSelected(app: App | null) {
    this.selectedApp.set(app);
    if (app) this.mode.set('pipedream-component');
  }

  protected onComponentSelected(component: PdComponent | null) {
    const app = this.selectedApp();
    if (!component || !app) return;
    const data: PipedreamStep = {
      source: 'pipedream',
      app,
      component,
      configuredProps: {},
    };
    this.picked.emit(data);
  }
}
```

### `step-picker.html`

```html
<div class="pd-step-picker">
  @switch (mode()) {
    @case ('choose-source') {
      <div class="pd-picker-options">
        <!-- Custom triggers section (only if any are registered) -->
        @if (customTriggers.length > 0) {
          <div class="pd-picker-section">
            <h4>Your Triggers</h4>
            <ul class="pd-custom-trigger-list">
              @for (trigger of customTriggers; track trigger.id) {
                <li
                  class="pd-custom-trigger-item"
                  (click)="selectCustom(trigger.id)"
                  (keydown.enter)="selectCustom(trigger.id)"
                  tabindex="0"
                  role="button"
                >
                  @if (trigger.icon) {
                    <span class="pd-trigger-icon">{{ trigger.icon }}</span>
                  }
                  <div>
                    <strong>{{ trigger.name }}</strong>
                    <small>{{ trigger.description }}</small>
                  </div>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Pipedream apps section -->
        <div class="pd-picker-section">
          <h4>{{ stepType() === 'trigger' ? 'App Triggers' : 'App Actions' }}</h4>
          <button
            type="button"
            class="pd-btn pd-btn--secondary"
            (click)="mode.set('pipedream-app')"
          >
            Browse {{ stepType() === 'trigger' ? 'Triggers' : 'Actions' }}
          </button>
        </div>
      </div>
    }

    @case ('pipedream-app') {
      <div class="pd-picker-app">
        <button type="button" class="pd-back-btn" (click)="mode.set('choose-source')">
          ← Back
        </button>
        <h4>Select an App</h4>
        <pd-app-selector [value]="selectedApp()" (valueChange)="onAppSelected($event)" />
      </div>
    }

    @case ('pipedream-component') {
      <div class="pd-picker-component">
        <button
          type="button"
          class="pd-back-btn"
          (click)="mode.set('pipedream-app'); selectedApp.set(null)"
        >
          ← Back
        </button>
        <h4>Select {{ stepType() === 'trigger' ? 'a Trigger' : 'an Action' }}</h4>
        @if (selectedApp()) {
          <pd-component-selector
            [app]="selectedApp()!"
            [componentType]="stepType()"
            (valueChange)="onComponentSelected($event)"
          />
        }
      </div>
    }
  }
</div>
```

---

## Step 6 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
export { WorkflowListComponent } from './lib/components/workflow-list/workflow-list';
export { WorkflowBuilderComponent } from './lib/components/workflow-builder/workflow-builder';
export { WorkflowStepComponent } from './lib/components/workflow-step/workflow-step';
export { StepPickerComponent } from './lib/components/step-picker/step-picker';
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/libs/connect-angular/src/lib/components/workflow-list/*` | Create (3 files) |
| `poc/libs/connect-angular/src/lib/components/workflow-builder/*` | Create (3 files) |
| `poc/libs/connect-angular/src/lib/components/workflow-step/*` | Create (3 files) |
| `poc/libs/connect-angular/src/lib/components/step-picker/*` | Create (3 files) |
| `poc/libs/connect-angular/src/index.ts` | Append exports |
| `poc/package.json` | Added `@angular/cdk` |

## Notes

- The trigger step (index 0) cannot be dragged — `[cdkDragDisabled]="i === 0"` prevents it
- `StepPickerComponent` shows the "Your Triggers" section only when `customTriggers.length > 0` — if no custom triggers are registered via DI, this section is hidden and users only see Pipedream options
- The `pd-connector` arrow between steps is decorative only; replace with an SVG line for a more polished look
- CSS for the drag-drop preview (`cdk-drag-preview` and `cdk-drop-list-dragging` classes) should be added to `workflow-builder.css`
