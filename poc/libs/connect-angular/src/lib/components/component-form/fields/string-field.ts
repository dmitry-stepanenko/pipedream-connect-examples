import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

function findInvalidInterpolation(value: string, availablePaths: string[]): string | null {
  if (!value || availablePaths.length === 0) return null;
  const hasTriggerPaths = availablePaths.some(p => p.startsWith('steps.trigger'));
  const pattern = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const ref = match[1].trim();
    console.log(JSON.parse(JSON.stringify({availablePaths, ref})));
    if (ref.startsWith('steps.trigger.') && !hasTriggerPaths) continue;
    if (!availablePaths.includes(ref)) return `Unknown reference: {{${ref}}}`;
  }
  return null;
}

@Component({
  selector: 'pd-string-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name" [error]="interpolationError()">
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
  availablePaths = input<string[]>([]);
  valueChange = output<string>();

  protected readonly interpolationError = computed(() =>
    findInvalidInterpolation(this.value() ?? '', this.availablePaths()),
  );

  protected asString() {
    return this.prop() as ConfigurableProp & { secret?: boolean; multiline?: boolean };
  }
}
