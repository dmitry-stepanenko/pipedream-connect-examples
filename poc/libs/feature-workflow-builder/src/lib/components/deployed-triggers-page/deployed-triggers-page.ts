import { Component, inject, signal, resource } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { WorkflowService } from '@poc/data-access-api';

interface DeployedTrigger {
  id: string;
  type: string;
  createdAt?: number;
  updatedAt?: number;
  workflow?: { id: string; name: string };
  [key: string]: unknown;
}

interface TriggerEvent {
  id?: string;
  ts?: number;
  [key: string]: unknown;
}

interface ExecutionRun {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string;
  error?: string;
  steps: Array<{ componentKey: string; status: string; error?: string }>;
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

  protected openWorkflow(trigger: DeployedTrigger) {
    if (!trigger.workflow) return;
    this.workflowService.setActiveWorkflow(trigger.workflow.id);
    this.router.navigate(['/workflows']);
  }

  protected readonly COMMON_KEYS = new Set(['id', 'type', 'createdAt', 'updatedAt', 'workflow']);

  protected extraProps(trigger: DeployedTrigger): [string, unknown][] {
    return Object.entries(trigger).filter(([k]) => !this.COMMON_KEYS.has(k));
  }

  protected readonly triggersResource = resource({
    loader: async () => {
      const res = await this.workflowService.listDeployedTriggers();
      return res.triggers as DeployedTrigger[];
    },
  });

  // ── Expand / collapse ────────────────────────────────────────────────────

  protected readonly expandedTriggerId = signal<string | null>(null);

  protected toggleExpanded(trigger: DeployedTrigger) {
    const next = this.expandedTriggerId() === trigger.id ? null : trigger.id;
    this.expandedTriggerId.set(next);
    if (next) this.ensureEventsLoaded(trigger);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  protected readonly eventsLoading = signal<string | null>(null);
  protected readonly eventsMap = signal<Record<string, TriggerEvent[]>>({});
  protected readonly eventsError = signal<Record<string, string>>({});
  protected readonly expandedEventKey = signal<string | null>(null);

  protected toggleEventItem(triggerId: string, index: number) {
    const key = `${triggerId}-${index}`;
    this.expandedEventKey.update((cur) => (cur === key ? null : key));
  }

  protected isEventExpanded(triggerId: string, index: number): boolean {
    return this.expandedEventKey() === `${triggerId}-${index}`;
  }

  private ensureEventsLoaded(trigger: DeployedTrigger) {
    if (this.eventsMap()[trigger.id]) return;
    this.loadEvents(trigger);
  }

  protected async loadEvents(trigger: DeployedTrigger) {
    this.eventsLoading.set(trigger.id);
    this.eventsError.update((m) => { const n = { ...m }; delete n[trigger.id]; return n; });
    try {
      const res = await this.workflowService.getDeployedTriggerEvents(trigger.id);
      this.eventsMap.update((m) => ({ ...m, [trigger.id]: res.events as TriggerEvent[] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.eventsError.update((m) => ({ ...m, [trigger.id]: msg }));
    } finally {
      this.eventsLoading.set(null);
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  protected readonly runsLoading = signal<string | null>(null);
  protected readonly runsMap = signal<Record<string, ExecutionRun[]>>({});
  protected readonly runsError = signal<Record<string, string>>({});
  protected readonly expandedRunId = signal<string | null>(null);

  protected toggleRun(id: string) {
    this.expandedRunId.update((cur) => (cur === id ? null : id));
  }

  protected async loadRuns(trigger: DeployedTrigger) {
    if (!trigger.workflow) return;
    const workflowId = trigger.workflow.id;
    this.runsLoading.set(trigger.id);
    this.runsError.update((m) => { const n = { ...m }; delete n[trigger.id]; return n; });
    try {
      const res = await this.workflowService.listRuns(workflowId, 20);
      this.runsMap.update((m) => ({ ...m, [workflowId]: res.runs as ExecutionRun[] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runsError.update((m) => ({ ...m, [trigger.id]: msg }));
    } finally {
      this.runsLoading.set(null);
    }
  }
}
