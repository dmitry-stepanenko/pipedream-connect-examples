import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-string-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      @if (asString().multiline) {
        <textarea
          [id]="prop().name"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
          rows="4"
          class="pd-input pd-textarea"
        ></textarea>
      } @else {
        <input
          [id]="prop().name"
          [type]="asString().secret ? 'password' : 'text'"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
          class="pd-input"
        />
      }
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
    .pd-textarea {
      resize: vertical;
    }
  `],
})
export class StringFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<string>('');
  valueChange = output<string>();

  protected asString() {
    return this.prop() as ConfigurableProp & { secret?: boolean; multiline?: boolean };
  }
}
