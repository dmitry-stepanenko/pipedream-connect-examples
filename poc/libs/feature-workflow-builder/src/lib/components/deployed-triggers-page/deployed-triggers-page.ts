import { Component, inject, signal, resource } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { Router } from '@angular/router';
import { WorkflowService } from '@poc/data-access-api';

interface DeployedTrigger {
  id: string;
  type: string;
  createdAt?: number;
  updatedAt?: number;
  workflow?: { id: string; name: string };
  [key: string]: unknown;
}

@Component({
  selector: 'pd-deployed-triggers-page',
  standalone: true,
  imports: [DatePipe, JsonPipe],
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

  protected readonly expandedTriggerId = signal<string | null>(null);
  protected readonly eventsLoading = signal<string | null>(null);
  protected readonly eventsMap = signal<Record<string, unknown[]>>({});
  protected readonly eventsError = signal<Record<string, string>>({});

  protected async toggleInvocations(trigger: DeployedTrigger) {
    if (this.expandedTriggerId() === trigger.id) {
      this.expandedTriggerId.set(null);
      return;
    }

    this.expandedTriggerId.set(trigger.id);

    if (this.eventsMap()[trigger.id]) return;

    this.eventsLoading.set(trigger.id);
    try {
      const res = await this.workflowService.getDeployedTriggerEvents(trigger.id);
      this.eventsMap.update((m) => ({ ...m, [trigger.id]: res.events }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.eventsError.update((m) => ({ ...m, [trigger.id]: msg }));
    } finally {
      this.eventsLoading.set(null);
    }
  }

  protected async refreshEvents(trigger: DeployedTrigger) {
    this.eventsLoading.set(trigger.id);
    this.eventsError.update((m) => { const n = { ...m }; delete n[trigger.id]; return n; });
    try {
      const res = await this.workflowService.getDeployedTriggerEvents(trigger.id);
      this.eventsMap.update((m) => ({ ...m, [trigger.id]: res.events }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.eventsError.update((m) => ({ ...m, [trigger.id]: msg }));
    } finally {
      this.eventsLoading.set(null);
    }
  }
}
