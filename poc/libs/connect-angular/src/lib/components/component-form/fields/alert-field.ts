import { Component, input } from '@angular/core';
import { ConfigurableProp } from '@pipedream/sdk';

@Component({
  selector: 'pd-alert-field',
  standalone: true,
  template: `
    <div class="pd-alert" [class]="'pd-alert pd-alert--' + asAlert().alertType">
      @if (prop().label) {
        <strong>{{ prop().label }}</strong>
      }
      <div [innerHTML]="asAlert().content"></div>
    </div>
  `,
  styles: [`
    .pd-alert {
      padding: 0.75rem 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    .pd-alert--info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
    }
    .pd-alert--warning {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }
    .pd-alert--error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
  `],
})
export class AlertFieldComponent {
  prop = input.required<ConfigurableProp>();

  protected asAlert() {
    return this.prop() as ConfigurableProp & { alertType?: string; content: string };
  }
}
