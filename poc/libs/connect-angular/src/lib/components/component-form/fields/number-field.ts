import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-number-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      <input
        [id]="prop().name"
        type="number"
        [step]="prop().type === 'integer' ? 1 : 'any'"
        [min]="asNumber().min ?? null"
        [max]="asNumber().max ?? null"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
        [required]="!prop().optional"
        class="pd-input"
      />
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
    }
  `],
})
export class NumberFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<number | null>(null);
  valueChange = output<number>();

  protected asNumber() {
    return this.prop() as ConfigurableProp & { min?: number; max?: number };
  }
}
