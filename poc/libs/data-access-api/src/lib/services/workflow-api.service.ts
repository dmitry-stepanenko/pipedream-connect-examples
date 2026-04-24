import { inject, Injectable } from '@angular/core';
import { PIPEDREAM_CONFIG } from '@poc/connect-angular';
import type { Workflow, StepSnapshot, TriggerEvent } from '../workflow.model';

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

  async listTriggerEvents(id: string): Promise<{ events: TriggerEvent[] }> {
    const res = await fetch(
      `${this.baseUrl}/${id}/trigger-events?externalUserId=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) throw new Error(`Failed to list trigger events: ${res.status}`);
    return res.json();
  }

  async captureEvent(
    id: string,
    timeoutMs: number,
  ): Promise<{ event: TriggerEvent }> {
    const res = await fetch(`${this.baseUrl}/${id}/capture-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId, timeoutMs }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to capture event: ${res.status}`);
    }
    return res.json();
  }

  async testRun(
    id: string,
    eventId: string,
  ): Promise<{ run: unknown }> {
    const res = await fetch(`${this.baseUrl}/${id}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalUserId: this.userId, eventId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to run workflow: ${res.status}`);
    }
    return res.json();
  }

  async listPublishedWorkflows(): Promise<{ workflows: Workflow[] }> {
    const res = await fetch(
      `${this.baseUrl}/deployed-triggers?externalUserId=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) throw new Error(`Failed to list published workflows: ${res.status}`);
    return res.json();
  }

  async listRuns(id: string, limit = 20): Promise<{ runs: unknown[] }> {
    const res = await fetch(
      `${this.baseUrl}/${id}/runs?externalUserId=${encodeURIComponent(this.userId)}&limit=${limit}`,
    );
    if (!res.ok) throw new Error(`Failed to list runs: ${res.status}`);
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
