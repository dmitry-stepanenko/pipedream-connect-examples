import { Component, inject, signal, computed, resource } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ConfiguredProps } from '@pipedream/sdk';
import { WorkflowService } from '@poc/data-access-api';
import type { WorkflowStepData, PipedreamStep, CustomTriggerStep } from '@poc/data-access-api';
import { CUSTOM_TRIGGERS, ComponentFormComponent } from '@poc/connect-angular';
import { WorkflowStepComponent } from '../workflow-step/workflow-step';
import { StepPickerComponent } from '../step-picker/step-picker';
import { ChatPanelComponent } from '../chat-panel/chat-panel';
import { slugFromKey, enumeratePaths } from '../chat-panel/step-reference.utils';

@Component({
  selector: 'pd-workflow-builder',
  standalone: true,
  imports: [
    DragDropModule,
    FormsModule,
    DatePipe,
    RouterLink,
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
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly publishing = signal(false);
  protected readonly publishError = signal<string | null>(null);
  protected readonly triggering = signal(false);
  protected readonly triggerError = signal<string | null>(null);
  protected readonly triggerResults = signal<unknown[] | null>(null);

  protected readonly emittingTestEvent = signal(false);
  protected readonly testEventError = signal<string | null>(null);
  protected readonly testEventJson = signal<string | null>(null);

  protected readonly tryingTrigger = signal(false);
  protected readonly tryTriggerError = signal<string | null>(null);
  protected readonly tryTriggerJson = signal<string | null>(null);

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
    if (selectedIdx <= 0) return [];
    const paths: string[] = [];
    for (let i = 0; i < selectedIdx; i++) {
      const step = steps[i];
      const data = step.data;
      if (!data || data.source !== 'pipedream') continue;
      const pd = data as PipedreamStep;
      if (!pd.component?.key) continue;
      if (step.outputSnapshot) {
        if (step.type === 'trigger') {
          // Trigger output is wrapped as { event: $return_value } at runtime
          paths.push(...enumeratePaths(step.outputSnapshot.$return_value, 'steps.trigger.event'));
        } else {
          paths.push(...enumeratePaths(step.outputSnapshot, `steps.${slugFromKey(pd.component.key)}`));
        }
      } else {
        const prefix = step.type === 'trigger' ? 'steps.trigger' : `steps.${slugFromKey(pd.component.key)}`;
        paths.push(prefix);
      }
    }
    return paths;
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

  protected async tryTrigger() {
    const w = this.workflow;
    if (!w) return;
    this.tryingTrigger.set(true);
    this.tryTriggerError.set(null);
    this.tryTriggerJson.set(null);
    const result = await this.workflowService.tryTrigger(w.id);
    if (result.success) {
      const step = this.workflowService.activeSteps()[0];
      const snapshot = step?.outputSnapshot;
      this.tryTriggerJson.set(snapshot ? JSON.stringify(snapshot.$return_value, null, 2) : null);
    } else {
      this.tryTriggerError.set(result.error);
    }
    this.tryingTrigger.set(false);
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
