import { Component, inject, signal, computed } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import type { ConfiguredProps } from '@pipedream/sdk';
import { WorkflowService } from '../../services/workflow.service';
import type { WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import { WorkflowStepComponent } from '../workflow-step/workflow-step';
import { StepPickerComponent } from '../step-picker/step-picker';
import { ComponentFormComponent } from '../component-form/component-form';
import { ChatPanelComponent } from '../chat-panel/chat-panel';

@Component({
  selector: 'pd-workflow-builder',
  standalone: true,
  imports: [
    DragDropModule,
    FormsModule,
    DatePipe,
    JsonPipe,
    WorkflowStepComponent,
    StepPickerComponent,
    ComponentFormComponent,
    ChatPanelComponent,
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
  protected readonly publishing = signal(false);
  protected readonly publishError = signal<string | null>(null);
  protected readonly triggering = signal(false);
  protected readonly triggerError = signal<string | null>(null);
  protected readonly triggerResults = signal<unknown[] | null>(null);

  protected readonly emittingTestEvent = signal(false);
  protected readonly testEventError = signal<string | null>(null);
  protected readonly testEventJson = signal<string | null>(null);

  protected readonly loadingTriggers = signal(false);
  protected readonly deployedTriggers = signal<unknown[] | null>(null);

  protected readonly loadingTriggerEvents = signal(false);
  protected readonly triggerEvents = signal<unknown[] | null>(null);
  protected readonly triggerEventsError = signal<string | null>(null);
  protected readonly expandedEventId = signal<string | null>(null);

  protected readonly loadingRuns = signal(false);
  protected readonly executionRuns = signal<unknown[] | null>(null);
  protected readonly executionRunsError = signal<string | null>(null);
  protected readonly expandedRunId = signal<string | null>(null);

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

  protected selectStep(stepId: string) {
    this.selectedStepId.set(stepId);
    this.panelTab.set('details');
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

  protected onDrop(event: CdkDragDrop<any[]>) {
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

  protected async publish() {
    const w = this.workflow;
    if (!w) return;
    this.publishing.set(true);
    this.publishError.set(null);
    try {
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
    this.triggering.set(true);
    this.triggerError.set(null);
    this.triggerResults.set(null);
    try {
      const res = await this.workflowService.triggerWorkflow(w.id);
      const run = res.run as { steps?: unknown[] };
      this.triggerResults.set(run?.steps ?? null);
    } catch (err) {
      this.triggerError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.triggering.set(false);
    }
  }

  protected async emitTestEvent() {
    const w = this.workflow;
    if (!w) return;
    this.emittingTestEvent.set(true);
    this.testEventError.set(null);
    this.testEventJson.set(null);
    try {
      const res = await this.workflowService.emitTestEvent(w.id);
      this.testEventJson.set(JSON.stringify(res.event, null, 2));
    } catch (err) {
      this.testEventError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.emittingTestEvent.set(false);
    }
  }

  protected async loadTriggerEvents() {
    const w = this.workflow;
    if (!w) return;
    this.loadingTriggerEvents.set(true);
    this.triggerEventsError.set(null);
    try {
      const res = await this.workflowService.listTriggerEvents(w.id, 10);
      this.triggerEvents.set(res.events);
    } catch (err) {
      this.triggerEventsError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingTriggerEvents.set(false);
    }
  }

  protected toggleEvent(id: string) {
    this.expandedEventId.update((cur) => (cur === id ? null : id));
  }

  protected toggleRun(id: string) {
    this.expandedRunId.update((cur) => (cur === id ? null : id));
  }

  protected async loadExecutionRuns() {
    const w = this.workflow;
    if (!w) return;
    this.loadingRuns.set(true);
    this.executionRunsError.set(null);
    try {
      const res = await this.workflowService.listRuns(w.id, 20);
      this.executionRuns.set(res.runs);
    } catch (err) {
      this.executionRunsError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingRuns.set(false);
    }
  }

  protected async loadDeployedTriggers() {
    this.loadingTriggers.set(true);
    this.deployedTriggers.set(null);
    try {
      const res = await this.workflowService.listDeployedTriggers();
      this.deployedTriggers.set(res.triggers);
    } finally {
      this.loadingTriggers.set(false);
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
