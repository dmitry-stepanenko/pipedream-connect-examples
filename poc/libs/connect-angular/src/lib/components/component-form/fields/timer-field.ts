import { Component, input, output, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

type TimerMode = 'cron' | 'interval';

interface TimerValue {
  cron?: string;
  intervalSeconds?: number;
}

@Component({
  selector: 'pd-timer-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      <div class="pd-timer-mode">
        <label class="pd-radio-label">
          <input type="radio" name="timer-mode-{{prop().name}}" value="cron"
            [ngModel]="mode()" (ngModelChange)="setMode($event)" />
          Cron
        </label>
        <label class="pd-radio-label">
          <input type="radio" name="timer-mode-{{prop().name}}" value="interval"
            [ngModel]="mode()" (ngModelChange)="setMode($event)" />
          Interval
        </label>
      </div>

      @if (mode() === 'cron') {
        <input
          [id]="prop().name"
          type="text"
          placeholder="0 * * * *"
          [ngModel]="cronValue()"
          (ngModelChange)="onCronChange($event)"
          class="pd-input"
        />
      } @else {
        <div class="pd-interval-row">
          <input
            [id]="prop().name"
            type="number"
            min="1"
            placeholder="Seconds"
            [ngModel]="intervalValue()"
            (ngModelChange)="onIntervalChange($event)"
            class="pd-input"
          />
          <span class="pd-interval-label">seconds</span>
        </div>
      }
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-timer-mode {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }
    .pd-radio-label {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-weight: normal;
      cursor: pointer;
    }
    .pd-input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .pd-interval-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .pd-interval-label {
      font-size: 0.85rem;
      color: #666;
    }
  `],
})
export class TimerFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<TimerValue | null>(null);
  valueChange = output<TimerValue>();

  // Derived from value so loading a saved workflow restores the correct mode
  protected readonly mode = computed<TimerMode>(() =>
    this.value()?.intervalSeconds !== undefined ? 'interval' : 'cron'
  );

  protected readonly cronValue = computed(() => this.value()?.cron ?? '');
  protected readonly intervalValue = computed(() => this.value()?.intervalSeconds ?? null);

  protected setMode(m: TimerMode) {
    // Emit a skeleton value so the parent updates value(), which drives mode()
    if (m === 'interval') {
      this.valueChange.emit({ intervalSeconds: this.value()?.intervalSeconds ?? 0 });
    } else {
      this.valueChange.emit({ cron: this.value()?.cron ?? '' });
    }
  }

  protected onCronChange(cron: string) {
    this.valueChange.emit({ cron });
  }

  protected onIntervalChange(seconds: number) {
    this.valueChange.emit({ intervalSeconds: seconds });
  }
}
