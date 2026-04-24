import { Component, inject, signal, resource } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { WorkflowService } from '@poc/data-access-api';
import type { Workflow, PipedreamStep } from '@poc/data-access-api';

interface ExecutionStepResult {
  componentKey: string;
  status: string;
  output?: unknown;
  error?: string;
}

interface ExecutionRun {
  id: string;
  status: string;
  triggerSource: string;
  triggerEventId?: string;
  triggerEvent: unknown;
  startedAt: string;
  error?: string;
  steps: ExecutionStepResult[];
}

@Component({
  selector: 'pd-deployed-triggers-page',
  standalone: true,
  imports: [DatePipe, JsonPipe, MatTabsModule],
  templateUrl: './deployed-triggers-page.html',
  styleUrl: './deployed-triggers-page.css',
})
export class DeployedTriggersPageComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly router = inject(Router);

  protected openWorkflow(workflow: Workflow) {
    this.workflowService.setActiveWorkflow(workflow.id);
    this.router.navigate(['/workflows']);
  }

  protected triggerInfo(workflow: Workflow): { name: string; app: string } | null {
    const step = workflow.steps[0];
    if (!step?.data || step.data.source !== 'pipedream') return null;
    const d = step.data as PipedreamStep;
    return {
      name: d.component.name ?? d.component.key,
      app: d.app.name ?? d.app.nameSlug,
    };
  }

  protected readonly workflowsResource = resource({
    loader: async () => {
      const res = await this.workflowService.listPublishedWorkflows();
      return res.workflows;
    },
  });

  // ── Expand / collapse workflow ────────────────────────────────────────────

  protected readonly expandedWorkflowId = signal<string | null>(null);

  protected toggleExpanded(workflow: Workflow) {
    const next = this.expandedWorkflowId() === workflow.id ? null : workflow.id;
    this.expandedWorkflowId.set(next);
    if (next) this.ensureRunsLoaded(workflow);
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  protected readonly runsLoading = signal<string | null>(null);
  protected readonly runsMap = signal<Record<string, ExecutionRun[]>>({});
  protected readonly runsError = signal<Record<string, string>>({});

  private ensureRunsLoaded(workflow: Workflow) {
    if (this.runsMap()[workflow.id]) return;
    this.loadRuns(workflow);
  }

  protected async loadRuns(workflow: Workflow) {
    this.runsLoading.set(workflow.id);
    this.runsError.update((m) => { const n = { ...m }; delete n[workflow.id]; return n; });
    try {
      const res = await this.workflowService.listRuns(workflow.id, 20);
      this.runsMap.update((m) => ({ ...m, [workflow.id]: res.runs as ExecutionRun[] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runsError.update((m) => ({ ...m, [workflow.id]: msg }));
    } finally {
      this.runsLoading.set(null);
    }
  }

  // ── Expand / collapse run ────────────────────────────────────────────────

  protected readonly expandedRunId = signal<string | null>(null);

  protected toggleRun(id: string) {
    this.expandedRunId.update((cur) => (cur === id ? null : id));
  }

  // ── Expand / collapse step ────────────────────────────────────────────────

  protected readonly expandedStepKey = signal<string | null>(null);

  protected toggleStep(runId: string, index: number) {
    const key = `${runId}-${index}`;
    this.expandedStepKey.update((cur) => (cur === key ? null : key));
  }

  protected isStepExpanded(runId: string, index: number): boolean {
    return this.expandedStepKey() === `${runId}-${index}`;
  }
}
