import { Component, inject, signal } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { WorkflowService } from '../../services/workflow.service';
import type { WorkflowStep } from '../../models/workflow.model';
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
