import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-boolean-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      <label class="pd-checkbox-label">
        <input
          [id]="prop().name"
          type="checkbox"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          class="pd-checkbox"
        />
        {{ prop().label ?? prop().name }}
      </label>
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: normal;
      cursor: pointer;
    }
    .pd-checkbox {
      width: 1rem;
      height: 1rem;
    }
  `],
})
export class BooleanFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<boolean>(false);
  valueChange = output<boolean>();
}
