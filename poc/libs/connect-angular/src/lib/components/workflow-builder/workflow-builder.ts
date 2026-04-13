import { Component, inject, signal, computed } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import type { ConfiguredProps } from '@pipedream/sdk';
import { WorkflowService } from '../../services/workflow.service';
import type { WorkflowStep, WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
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

  protected get workflow() {
    return this.workflowService.activeWorkflow();
  }

  protected readonly selectedStep = computed((): WorkflowStep | null => {
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

  protected selectStep(stepId: string) {
    this.selectedStepId.set(stepId);
    this.panelTab.set('details');
  }

  protected addStep() {
    const w = this.workflow;
    if (!w) return;
    const step = this.workflowService.addStep(w.id);
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
}
