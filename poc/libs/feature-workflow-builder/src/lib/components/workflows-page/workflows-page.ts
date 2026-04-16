import { Component } from '@angular/core';
import { WorkflowListComponent } from '../workflow-list/workflow-list';
import { WorkflowBuilderComponent } from '../workflow-builder/workflow-builder';

@Component({
  selector: 'pd-workflows-page',
  standalone: true,
  imports: [WorkflowListComponent, WorkflowBuilderComponent],
  template: `
    <div class="pd-workflows-layout">
      <aside class="pd-workflows-sidebar">
        <pd-workflow-list />
      </aside>
      <main class="pd-workflows-main">
        <pd-workflow-builder />
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pd-workflows-layout {
      display: flex;
      height: 100%;
    }
    .pd-workflows-sidebar {
      width: 280px;
      flex-shrink: 0;
      border-right: 1px solid #e5e7eb;
      padding: 16px;
      overflow-y: auto;
      background: #f9fafb;
    }
    .pd-workflows-main {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      min-width: 0;
    }
  `],
})
export class WorkflowsPageComponent {}
