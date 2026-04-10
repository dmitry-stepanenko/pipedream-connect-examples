import { Component, input, output, computed, inject } from '@angular/core';
import type { WorkflowStep, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';

@Component({
  selector: 'pd-workflow-step',
  standalone: true,
  templateUrl: './workflow-step.html',
  styleUrl: './workflow-step.css',
})
export class WorkflowStepComponent {
  step = input.required<WorkflowStep>();
  stepIndex = input.required<number>();
  selected = input(false);
  select = output<void>();
  remove = output<void>();

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

  protected readonly customTriggerName = computed((): string => {
    const d = this.step().data;
    if (d?.source !== 'custom') return '';
    const ct = d as CustomTriggerStep;
    return this.customTriggers.find((t) => t.id === ct.customTriggerId)?.name ?? ct.customTriggerId;
  });
}
