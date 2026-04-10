import { Component, input, output, signal, inject } from '@angular/core';
import { ConfigurableProp } from '@pipedream/sdk';
import { PipedreamClientService } from '../../../services/pipedream-client.service';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-app-field',
  standalone: true,
  imports: [FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()">
      @if (value()) {
        <div class="pd-connected-account">
          <span>Connected: {{ value() }}</span>
          <button type="button" class="pd-btn-disconnect" (click)="disconnect()">Disconnect</button>
        </div>
      } @else {
        <button
          type="button"
          class="pd-connect-btn"
          [disabled]="connecting()"
          (click)="connect()"
        >
          {{ connecting() ? 'Connecting...' : 'Connect ' + asApp().app }}
        </button>
      }
      @if (error()) {
        <p class="pd-error">{{ error() }}</p>
      }
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-connected-account {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 4px;
    }
    .pd-btn-disconnect {
      padding: 0.3rem 0.6rem;
      background: #fee2e2;
      border: 1px solid #fca5a5;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .pd-connect-btn {
      padding: 0.5rem 1rem;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .pd-connect-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .pd-error {
      font-size: 0.85rem;
      color: #e53e3e;
      margin: 0.25rem 0 0;
    }
  `],
})
export class AppFieldComponent {
  prop = input.required<ConfigurableProp>();
  /** value is the connected account ID */
  value = input<string | null>(null);
  valueChange = output<string | null>();

  protected readonly connecting = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly client = inject(PipedreamClientService);

  protected asApp() {
    return this.prop() as ConfigurableProp & { app: string };
  }

  protected async connect() {
    this.connecting.set(true);
    this.error.set(null);
    try {
      const result = await this.client.connectAccount(this.asApp().app);
      this.valueChange.emit(result.id);
    } catch {
      this.error.set('Connection failed. Please try again.');
    } finally {
      this.connecting.set(false);
    }
  }

  protected disconnect() {
    this.valueChange.emit(null);
  }
}
