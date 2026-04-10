import { Component, input, output, signal, inject } from '@angular/core';
import { App, Component as PdComponent } from '@pipedream/sdk';
import { CUSTOM_TRIGGERS } from '../../tokens/custom-triggers.token';
import type { WorkflowStepData, PipedreamStep, CustomTriggerStep } from '../../models/workflow.model';
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
