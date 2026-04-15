import { inject, Injectable } from '@angular/core';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';
import type {
  Workflow,
  WorkflowStep,
  WorkflowStepData,
  StepOutputSchema,
} from '../models/workflow.model';

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

  async triggerWorkflow(id: string): Promise<{ results: unknown[] }> {
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
