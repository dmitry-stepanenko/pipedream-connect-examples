import { Component, inject, input, signal } from '@angular/core';
import { WorkflowService } from '@poc/data-access-api';
import { CHAT_SEND_MESSAGE } from '../connect-app.component';

@Component({
  selector: 'pd-try-trigger',
  standalone: true,
  template: `
    @switch (state()) {
      @case ('idle') {
        <div class="try-trigger-card">
          <p class="try-trigger-label">
            Click <strong>Try Now</strong> to capture a sample event from the
            trigger. The AI assistant needs it to configure the next steps.
          </p>
          <button class="try-trigger-btn" (click)="run()">▶ Try Now</button>
        </div>
      }
      @case ('running') {
        <div class="try-trigger-card">
          <button class="try-trigger-btn" disabled>Capturing event…</button>
        </div>
      }
      @case ('success') {
        <div class="try-trigger-card try-trigger-card--success">
          <span class="try-trigger-ok">✓ Trigger sample captured — continuing…</span>
        </div>
      }
      @case ('error') {
        <div class="try-trigger-card try-trigger-card--error">
          <span class="try-trigger-error">{{ errorMessage() }}</span>
          <button class="try-trigger-btn try-trigger-btn--retry" (click)="run()">Retry</button>
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 4px 0;
      }

      .try-trigger-card {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #f8fafc;
      }

      .try-trigger-card--success {
        background: #f0fdf4;
        border-color: #86efac;
      }

      .try-trigger-card--error {
        background: #fef2f2;
        border-color: #fca5a5;
        flex-wrap: wrap;
      }

      .try-trigger-label {
        margin: 0;
        font-size: 0.875rem;
        color: #374151;
      }

      .try-trigger-btn {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        background: #4f46e5;
        color: white;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
      }

      .try-trigger-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .try-trigger-btn--retry {
        background: #dc2626;
      }

      .try-trigger-ok {
        font-size: 0.875rem;
        color: #166534;
        font-weight: 500;
      }

      .try-trigger-error {
        font-size: 0.875rem;
        color: #991b1b;
        flex: 1;
      }
    `,
  ],
})
export class TryTriggerComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly sendMessage = inject(CHAT_SEND_MESSAGE);

  readonly workflowId = input.required<string>();

  protected readonly state = signal<'idle' | 'running' | 'success' | 'error'>(
    'idle',
  );
  protected readonly errorMessage = signal<string | null>(null);

  async run() {
    this.state.set('running');
    this.errorMessage.set(null);

    const result = await this.workflowService.tryTrigger(this.workflowId());

    if (result.success) {
      this.state.set('success');
      this.sendMessage(
        'I clicked "Try Now" and the trigger sample was captured successfully.',
      );
    } else {
      this.state.set('error');
      this.errorMessage.set(result.error ?? 'Unknown error');
    }
  }
}
