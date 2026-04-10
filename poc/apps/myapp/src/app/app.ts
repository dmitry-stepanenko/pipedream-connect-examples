import { Component } from '@angular/core';
import {
  WorkflowListComponent,
  WorkflowBuilderComponent,
} from '@poc/connect-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [WorkflowListComponent, WorkflowBuilderComponent],
  template: `
    <div class="app-layout">
      <aside class="app-sidebar">
        <h1 class="app-logo">Workflow Builder</h1>
        <pd-workflow-list (open)="onWorkflowOpen($event)" />
      </aside>

      <main class="app-main">
        <pd-workflow-builder />
      </main>
    </div>
  `,
  styles: [`
    .app-layout {
      display: flex;
      height: 100vh;
      font-family: system-ui, sans-serif;
    }
    .app-sidebar {
      width: 280px;
      border-right: 1px solid #e5e7eb;
      padding: 16px;
      overflow-y: auto;
      background: #f9fafb;
    }
    .app-logo {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 24px;
      color: #111827;
    }
    .app-main {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
  `],
})
export class App {
  protected onWorkflowOpen(_id: string) {
    // WorkflowService already tracks the active workflow via setActiveWorkflow()
    // called inside WorkflowListComponent -- nothing extra needed here
  }
}
