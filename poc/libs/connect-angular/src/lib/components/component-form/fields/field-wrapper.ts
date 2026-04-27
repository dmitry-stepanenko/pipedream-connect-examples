import { Component, input } from '@angular/core';
import { ConfigurableProp } from '@pipedream/sdk';

@Component({
  selector: 'pd-field-wrapper',
  standalone: true,
  template: `
    <div class="pd-field" [class.pd-field--required]="!prop().optional">
      <label [for]="fieldId()">
        {{ prop().label ?? prop().name }}
        @if (prop().optional === false) { <span class="pd-required">*</span> }
      </label>

      <ng-content />

      @if (prop().description) {
        <p class="pd-field-description" [innerHTML]="prop().description"></p>
      }
      @if (error()) {
        <p class="pd-field-error">{{ error() }}</p>
      }
    </div>
  `,
  styles: [`
    .pd-field {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      font-weight: 500;
      margin-bottom: 0.25rem;
    }
    .pd-required {
      color: #e53e3e;
    }
    .pd-field-description {
      font-size: 0.85rem;
      color: #666;
      margin: 0.25rem 0 0;
    }
    .pd-field-error {
      font-size: 0.85rem;
      color: #e53e3e;
      margin: 0.25rem 0 0;
    }
  `],
})
export class FieldWrapperComponent {
  prop = input.required<ConfigurableProp>();
  fieldId = input('');
  error = input<string | null>(null);
}
