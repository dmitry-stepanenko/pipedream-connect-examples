import { Component, input, output, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-array-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()">
      @for (item of items(); track $index) {
        <div class="pd-array-row">
          <input
            type="text"
            [ngModel]="item"
            (ngModelChange)="updateItem($index, $event)"
            class="pd-input"
          />
          <button type="button" class="pd-btn-remove" (click)="removeItem($index)">−</button>
        </div>
      }
      <button type="button" class="pd-btn-add" (click)="addItem()">+ Add item</button>
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-array-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      align-items: center;
    }
    .pd-input {
      flex: 1;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .pd-btn-remove {
      padding: 0.4rem 0.6rem;
      background: #fee2e2;
      border: 1px solid #fca5a5;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    }
    .pd-btn-add {
      padding: 0.4rem 0.8rem;
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
  `],
})
export class ArrayFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<unknown[]>([]);
  valueChange = output<unknown[]>();

  protected readonly items = computed(() => this.value() ?? []);

  protected addItem() {
    this.valueChange.emit([...this.items(), '']);
  }

  protected removeItem(index: number) {
    const next = [...this.items()];
    next.splice(index, 1);
    this.valueChange.emit(next);
  }

  protected updateItem(index: number, val: unknown) {
    const next = [...this.items()];
    next[index] = val;
    this.valueChange.emit(next);
  }
}
