import { Component, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-object-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name" [error]="parseError()">
      <textarea
        [id]="prop().name"
        [ngModel]="jsonText()"
        (ngModelChange)="onTextChange($event)"
        [required]="!prop().optional"
        rows="6"
        class="pd-input pd-textarea"
        placeholder='{ "key": "value" }'
      ></textarea>
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
      font-family: monospace;
    }
    .pd-textarea {
      resize: vertical;
    }
  `],
})
export class ObjectFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<Record<string, unknown> | null>(null);
  valueChange = output<Record<string, unknown>>();

  protected readonly parseError = signal<string | null>(null);

  protected readonly jsonText = computed(() => {
    const v = this.value();
    if (v == null) return '';
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return '';
    }
  });

  protected onTextChange(text: string) {
    if (!text.trim()) {
      this.parseError.set(null);
      this.valueChange.emit({});
      return;
    }
    try {
      const parsed = JSON.parse(text);
      this.parseError.set(null);
      this.valueChange.emit(parsed);
    } catch {
      this.parseError.set('Invalid JSON');
    }
  }
}
