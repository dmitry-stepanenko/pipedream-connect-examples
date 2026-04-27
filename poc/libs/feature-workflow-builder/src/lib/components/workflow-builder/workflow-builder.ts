import { Component, inject, signal, computed, resource } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ConfiguredProps } from '@pipedream/sdk';
import { WorkflowService } from '@poc/data-access-api';
import type { WorkflowStepData, PipedreamStep, CustomTriggerStep, WorkflowStep, TriggerEvent } from '@poc/data-access-api';
import { CUSTOM_TRIGGERS, ComponentFormComponent } from '@poc/connect-angular';
import { WorkflowStepComponent } from '../workflow-step/workflow-step';
import { StepPickerComponent } from '../step-picker/step-picker';
import { ChatPanelComponent } from '../chat-panel/chat-panel';
import { EventPickerDialogComponent } from '../event-picker-dialog/event-picker-dialog';
import { getAvailablePaths } from '../chat-panel/step-reference.utils';

@Component({
  selector: 'pd-workflow-builder',
  standalone: true,
  imports: [
    DragDropModule,
    FormsModule,
    DatePipe,
    JsonPipe,
    RouterLink,
    WorkflowStepComponent,
    StepPickerComponent,
    ComponentFormComponent,
    ChatPanelComponent,
    EventPickerDialogComponent,
  ],
  templateUrl: './workflow-builder.html',
  styleUrl: './workflow-builder.css',
})
export class WorkflowBuilderComponent {
  protected readonly workflowService = inject(WorkflowService);
  protected readonly customTriggers = inject(CUSTOM_TRIGGERS);
  protected readonly editingName = signal(false);
  protected readonly selectedStepId = signal<string | null>(null);
  protected readonly panelTab = signal<'details' | 'chat'>('details');
  protected readonly testingStepId = signal<string | null>(null);
  protected readonly testError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly publishing = signal(false);
  protected readonly publishError = signal<string | null>(null);
  protected readonly triggering = signal(false);
  protected readonly triggerError = signal<string | null>(null);
  protected readonly triggerResults = signal<unknown[] | null>(null);

  protected readonly capturingEvent = signal(false);
  protected readonly captureCountdown = signal<number | null>(null);
  protected readonly captureError = signal<string | null>(null);
  protected readonly testRunDialogOpen = signal(false);
  protected readonly selectedEventId = signal<string | null>(null);
  protected readonly expandedEventId = signal<string | null>(null);

  protected readonly runsSummary = resource({
    loader: async () => {
      const wf = this.workflowService.activeWorkflow();
      const step = this.selectedStep();
      const published = this.isPublished();
      if (!wf || step?.type !== 'trigger' || !published) return undefined;
      const res = await this.workflowService.listRuns(wf.id, 5);
      return res.runs as Array<{ id: string; status: string; startedAt: string }>;
    },
  });

  protected get workflow() {
    return this.workflowService.activeWorkflow();
  }

  protected readonly selectedStep = computed(() => {
    const id = this.selectedStepId();
    if (!id) return null;
    return this.workflowService.activeSteps().find((s) => s.id === id) ?? null;
  });

  protected readonly selectedPipedreamData = computed((): PipedreamStep | null => {
    const d = this.selectedStep()?.data;
    return d?.source === 'pipedream' ? (d as PipedreamStep) : null;
  });

  protected readonly selectedCustomData = computed((): CustomTriggerStep | null => {
    const d = this.selectedStep()?.data;
    return d?.source === 'custom' ? (d as CustomTriggerStep) : null;
  });

  protected readonly selectedCustomTriggerName = computed((): string => {
    const d = this.selectedCustomData();
    if (!d) return '';
    return this.customTriggers.find((t) => t.id === d.customTriggerId)?.name ?? d.customTriggerId;
  });

  protected readonly isPublished = computed(
    () => this.workflow?.status === 'published',
  );

  protected readonly canPublish = computed((): boolean => {
    const w = this.workflow;
    if (!w || w.status === 'published') return false;
    const trigger = w.steps[0];
    if (!trigger?.data) return false;
    const actions = w.steps.slice(1).filter((s) => s.data);
    return actions.length > 0;
  });

  protected readonly availablePaths = computed((): string[] => {
    const steps = this.workflowService.activeSteps();
    const selectedIdx = steps.findIndex(s => s.id === this.selectedStepId());
    return getAvailablePaths(steps, selectedIdx);
  });

  protected selectStep(stepId: string) {
    this.selectedStepId.set(stepId);
    this.panelTab.set('details');
    const step = this.workflowService.activeSteps().find((s) => s.id === stepId);
    if (step?.type === 'trigger') {
      const w = this.workflow;
      if (w) void this.workflowService.loadTriggerEvents(w.id);
    }
  }

  protected async addStep() {
    const w = this.workflow;
    if (!w) return;
    const step = await this.workflowService.addStep(w.id);
    this.selectedStepId.set(step.id);
  }

  protected removeStep(stepId: string) {
    const w = this.workflow;
    if (!w) return;
    if (this.selectedStepId() === stepId) {
      this.selectedStepId.set(null);
    }
    this.workflowService.removeStep(w.id, stepId);
  }

  protected onDrop(event: CdkDragDrop<WorkflowStep[]>) {
    const w = this.workflow;
    if (!w) return;
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

  protected clearStepData() {
    const w = this.workflow;
    const step = this.selectedStep();
    if (!w || !step) return;
    this.workflowService.configureStep(w.id, step.id, null);
  }

  protected onStepPicked(data: WorkflowStepData) {
    const w = this.workflow;
    const step = this.selectedStep();
    if (!w || !step) return;
    this.workflowService.configureStep(w.id, step.id, data);
  }

  protected onFormConfigure(configuredProps: ConfiguredProps) {
    const w = this.workflow;
    const step = this.selectedStep();
    const current = this.selectedPipedreamData();
    if (!w || !step || !current) return;
    this.workflowService.configureStep(w.id, step.id, {
      ...current,
      configuredProps,
    });
  }

  protected readonly canTestSelectedStep = computed((): boolean => {
    const pd = this.selectedPipedreamData();
    return !!pd?.component?.key;
  });

  protected async testStep() {
    const w = this.workflow;
    const step = this.selectedStep();
    if (!w || !step) return;
    this.testingStepId.set(step.id);
    this.testError.set(null);
    const result = await this.workflowService.testStep(w.id, step.id);
    if (!result.success) {
      this.testError.set(result.error);
    }
    this.testingStepId.set(null);
  }

  protected async save() {
    const w = this.workflow;
    if (!w) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.workflowService.save(w.id);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async cancel() {
    const w = this.workflow;
    if (!w) return;
    await this.workflowService.revert(w.id);
    this.saveError.set(null);
  }

  protected async publish() {
    const w = this.workflow;
    if (!w) return;
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      if (this.workflowService.dirty()) {
        await this.workflowService.save(w.id);
      }
      await this.workflowService.publishWorkflow(w.id);
    } catch (err) {
      this.publishError.set(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.publishing.set(false);
    }
  }

  protected async triggerWorkflow() {
    const w = this.workflow;
    if (!w) return;
    const eventId = this.selectedEventId();
    if (!eventId) return;
    this.triggering.set(true);
    this.triggerError.set(null);
    this.triggerResults.set(null);
    try {
      const res = await this.workflowService.testRun(w.id, eventId);
      const run = res.run as { steps?: unknown[] };
      this.triggerResults.set(run?.steps ?? null);
    } catch (err) {
      this.triggerError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.triggering.set(false);
      this.testRunDialogOpen.set(false);
      this.selectedEventId.set(null);
    }
  }

  protected openTestRunDialog() {
    this.selectedEventId.set(null);
    this.testRunDialogOpen.set(true);
  }

  protected closeTestRunDialog() {
    this.testRunDialogOpen.set(false);
    this.selectedEventId.set(null);
  }

  protected useEvent(ev: TriggerEvent) {
    const w = this.workflow;
    if (!w) return;
    this.workflowService.setActiveTriggerEvent(w.id, ev);
  }

  protected async captureEvent() {
    const w = this.workflow;
    if (!w) return;
    const timeoutMs = 90_000;
    this.capturingEvent.set(true);
    this.captureCountdown.set(timeoutMs / 1000);
    this.captureError.set(null);

    const timer = setInterval(() => {
      this.captureCountdown.update((v) => (v !== null && v > 0 ? v - 1 : 0));
    }, 1000);

    try {
      const result = await this.workflowService.captureEvent(w.id, timeoutMs);
      if (!result.success) {
        this.captureError.set(result.error);
      } else {
        await this.workflowService.loadTriggerEvents(w.id);
      }
    } finally {
      clearInterval(timer);
      this.capturingEvent.set(false);
      this.captureCountdown.set(null);
    }
  }

  protected async unpublish() {
    const w = this.workflow;
    if (!w) return;
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.workflowService.unpublishWorkflow(w.id);
    } catch (err) {
      this.publishError.set(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.publishing.set(false);
    }
  }
}
