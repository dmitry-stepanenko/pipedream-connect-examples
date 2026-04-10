import { Component, input, output, signal, inject, computed } from '@angular/core';
import type { WorkflowStep, WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
import type { ConfiguredProps } from '@pipedream/sdk';
import { WorkflowService } from '../../services/workflow.service';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import { StepPickerComponent } from '../step-picker/step-picker';
import { ComponentFormComponent } from '../component-form/component-form';

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

  protected readonly pipedreamData = computed((): PipedreamStep | null => {
    const d = this.step().data;
    return d?.source === 'pipedream' ? (d as PipedreamStep) : null;
  });

  protected readonly customData = computed((): CustomTriggerStep | null => {
    const d = this.step().data;
    return d?.source === 'custom' ? (d as CustomTriggerStep) : null;
  });

  protected readonly customTriggerName = computed((): string => {
    const d = this.customData();
    if (!d) return '';
    return this.customTriggers.find((t) => t.id === d.customTriggerId)?.name ?? d.customTriggerId;
  });

  protected onStepPicked(data: WorkflowStepData) {
    this.workflowService.configureStep(this.workflowId(), this.step().id, data);
    this.expanded.set(true); // open form after picking
  }

  protected onFormConfigure(configuredProps: ConfiguredProps) {
    const current = this.pipedreamData();
    if (!current) return;
    this.workflowService.configureStep(this.workflowId(), this.step().id, {
      ...current,
      configuredProps,
    });
  }
}
