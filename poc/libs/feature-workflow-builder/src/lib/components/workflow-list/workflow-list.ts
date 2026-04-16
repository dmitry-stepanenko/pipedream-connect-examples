import { Component, inject, OnInit, output } from '@angular/core';
import { WorkflowService } from '../../services/workflow.service';

@Component({
  selector: 'pd-workflow-list',
  standalone: true,
  templateUrl: './workflow-list.html',
  styleUrl: './workflow-list.css',
})
export class WorkflowListComponent implements OnInit {
  open = output<string>(); // emits workflow id

  protected readonly workflowService = inject(WorkflowService);

  ngOnInit() {
    this.workflowService.loadWorkflows();
  }

  protected async create() {
    const w = await this.workflowService.createWorkflow();
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
