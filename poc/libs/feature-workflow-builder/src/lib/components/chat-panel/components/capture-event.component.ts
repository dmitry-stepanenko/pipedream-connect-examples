import { Component, inject, input, signal } from '@angular/core';
import { WorkflowService } from '@poc/data-access-api';
import { CHAT_SEND_MESSAGE } from '../connect-app.component';

@Component({
  selector: 'pd-capture-event',
  standalone: true,
  template: `
    @switch (state()) {
      @case ('idle') {
        <div class="capture-event-card">
          <p class="capture-event-label">
            Click <strong>Capture Event</strong> to capture a sample event from the
            trigger. The AI assistant needs it to configure the next steps.
          </p>
          <button class="capture-event-btn" (click)="run()">⏺ Capture Event</button>
        </div>
      }
      @case ('running') {
        <div class="capture-event-card">
          <button class="capture-event-btn" disabled>
            Capturing… {{ countdown() }}s
          </button>
        </div>
      }
      @case ('success') {
        <div class="capture-event-card capture-event-card--success">
          <span class="capture-event-ok">✓ Trigger sample captured — continuing…</span>
        </div>
      }
      @case ('error') {
        <div class="capture-event-card capture-event-card--error">
          <span class="capture-event-error">{{ errorMessage() }}</span>
          <button class="capture-event-btn capture-event-btn--retry" (click)="run()">Retry</button>
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

      .capture-event-card {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #f8fafc;
      }

      .capture-event-card--success {
        background: #f0fdf4;
        border-color: #86efac;
      }

      .capture-event-card--error {
        background: #fef2f2;
        border-color: #fca5a5;
        flex-wrap: wrap;
      }

      .capture-event-label {
        margin: 0;
        font-size: 0.875rem;
        color: #374151;
      }

      .capture-event-btn {
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

      .capture-event-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .capture-event-btn--retry {
        background: #dc2626;
      }

      .capture-event-ok {
        font-size: 0.875rem;
        color: #166534;
        font-weight: 500;
      }

      .capture-event-error {
        font-size: 0.875rem;
        color: #991b1b;
        flex: 1;
      }
    `,
  ],
})
export class CaptureEventComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly sendMessage = inject(CHAT_SEND_MESSAGE);

  readonly workflowId = input.required<string>();

  protected readonly state = signal<'idle' | 'running' | 'success' | 'error'>(
    'idle',
  );
  protected readonly countdown = signal<number>(90);
  protected readonly errorMessage = signal<string | null>(null);

  async run() {
    const timeoutMs = 90_000;
    this.state.set('running');
    this.countdown.set(timeoutMs / 1000);
    this.errorMessage.set(null);

    const timer = setInterval(() => {
      this.countdown.update((v) => (v > 0 ? v - 1 : 0));
    }, 1000);

    try {
      const result = await this.workflowService.captureEvent(this.workflowId(), timeoutMs);

      if (result.success) {
        this.state.set('success');
        this.sendMessage(
          'I clicked "Capture Event" and the trigger sample was captured successfully.',
        );
      } else {
        this.state.set('error');
        this.errorMessage.set(result.error ?? 'Unknown error');
      }
    } finally {
      clearInterval(timer);
    }
  }
}
