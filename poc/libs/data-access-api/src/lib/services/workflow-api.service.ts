import { inject, Injectable } from '@angular/core';
import { PIPEDREAM_CONFIG } from '@poc/connect-angular';
import type { Workflow, StepSnapshot } from '../workflow.model';

@Injectable({ providedIn: 'root' })
export class WorkflowApiService {
  private readonly config = inject(PIPEDREAM_CONFIG);

  private get baseUrl(): string {
    return `${this.config.apiBaseUrl}/api/workflows`;
  }

  private get userId(): string {
    return this.config.externalUserId;
  }

  async listWorkflows(): Promise<Workflow[]> {
    const res = await fetch(
      `${this.baseUrl}?externalUserId=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) throw new Error(`Failed to list workflows: ${res.status}`);
    const data = await res.json();
    return data.workflows;
  }

  async createWorkflow(name?: string): Promise<Workflow> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId, name }),
    });
    if (!res.ok) throw new Error(`Failed to create workflow: ${res.status}`);
    const data = await res.json();
    return data.workflow;
  }

  async getWorkflow(id: string): Promise<Workflow> {
    const res = await fetch(
      `${this.baseUrl}/${id}?externalUserId=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) throw new Error(`Failed to get workflow: ${res.status}`);
    const data = await res.json();
    return data.workflow;
  }

  async saveWorkflow(workflow: Workflow): Promise<Workflow> {
    const res = await fetch(`${this.baseUrl}/${workflow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        externalUserId: this.userId,
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
      }),
    });
    if (!res.ok) throw new Error(`Failed to save workflow: ${res.status}`);
    const data = await res.json();
    return data.workflow;
  }

  async deleteWorkflow(id: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${id}?externalUserId=${encodeURIComponent(this.userId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`Failed to delete workflow: ${res.status}`);
  }

  async publishWorkflow(id: string): Promise<Workflow> {
    const res = await fetch(`${this.baseUrl}/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to publish: ${res.status}`);
    }
    const data = await res.json();
    return data.workflow;
  }

  async testStep(
    workflowId: string,
    stepId: string,
  ): Promise<{ success: boolean; outputSnapshot: StepSnapshot | null; error: string | null }> {
    const res = await fetch(`${this.baseUrl}/${workflowId}/steps/${stepId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    const data = await res.json();
    return data as { success: boolean; outputSnapshot: StepSnapshot | null; error: string | null };
  }

  async getTriggerSnapshot(id: string): Promise<StepSnapshot> {
    const res = await fetch(`${this.baseUrl}/${id}/trigger-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to get trigger snapshot: ${res.status}`);
    }
    const data = await res.json();
    return (data as { snapshot: StepSnapshot }).snapshot;
  }

  async emitTestEvent(id: string): Promise<{ event: unknown }> {
    const res = await fetch(`${this.baseUrl}/${id}/emit-test-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to emit test event: ${res.status}`);
    }
    return res.json();
  }

  async listTriggerEvents(id: string, n = 10): Promise<{ events: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/${id}/trigger-events?externalUserId=${encodeURIComponent(this.userId)}&n=${n}`,
    );
    if (!res.ok) throw new Error(`Failed to list trigger events: ${res.status}`);
    return res.json();
  }

  async listDeployedTriggers(): Promise<{ triggers: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/deployed-triggers?externalUserId=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) throw new Error(`Failed to list deployed triggers: ${res.status}`);
    return res.json();
  }

  async getDeployedTriggerEvents(triggerId: string, n = 20): Promise<{ events: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/deployed-triggers/${encodeURIComponent(triggerId)}/events?externalUserId=${encodeURIComponent(this.userId)}&n=${n}`,
    );
    if (!res.ok) throw new Error(`Failed to fetch trigger events: ${res.status}`);
    return res.json();
  }

  async triggerWorkflow(id: string): Promise<{ run: unknown }> {
    const res = await fetch(`${this.baseUrl}/${id}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to trigger: ${res.status}`);
    }
    return res.json();
  }

  async listRuns(id: string, limit = 20): Promise<{ runs: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/${id}/runs?externalUserId=${encodeURIComponent(this.userId)}&limit=${limit}`,
    );
    if (!res.ok) throw new Error(`Failed to list runs: ${res.status}`);
    return res.json();
  }

  async tryTrigger(id: string): Promise<{ snapshot: import('../workflow.model').StepSnapshot }> {
    const res = await fetch(`${this.baseUrl}/${id}/try-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to try trigger: ${res.status}`);
    }
    return res.json();
  }

  async unpublishWorkflow(id: string): Promise<Workflow> {
    const res = await fetch(`${this.baseUrl}/${id}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to unpublish: ${res.status}`);
    }
    const data = await res.json();
    return data.workflow;
  }
}
