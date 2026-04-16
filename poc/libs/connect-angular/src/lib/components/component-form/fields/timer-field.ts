import { Component, input, output, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp } from '@pipedream/sdk';
import cronstrue from 'cronstrue';
import { FieldWrapperComponent } from './field-wrapper';

type TimerMode = 'cron' | 'interval';
type IntervalUnit = 'second' | 'minute' | 'hour';

interface TimerValue {
  cron?: string;
  intervalSeconds?: number;
}

function parseIntervalSeconds(seconds: number): { amount: number; unit: IntervalUnit } {
  if (seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'hour' };
  if (seconds % 60 === 0) return { amount: seconds / 60, unit: 'minute' };
  return { amount: seconds, unit: 'second' };
}

const UNIT_MULTIPLIERS: Record<IntervalUnit, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
};

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
          [class.pd-input--invalid]="cronHint()?.valid === false"
        />
        @if (cronHint(); as hint) {
          <p class="pd-cron-hint" [class.pd-cron-hint--error]="!hint.valid">{{ hint.text }}</p>
        }
      } @else {
        <label class="pd-interval-row">
          <div class="pd-interval-every">Every</div>
          <input
            [id]="prop().name"
            type="number"
            min="1"
            [ngModel]="intervalAmount()"
            (ngModelChange)="onIntervalAmountChange($event)"
            class="pd-input pd-input--amount"
          />
          <select
            [ngModel]="intervalUnit()"
            (ngModelChange)="onIntervalUnitChange($event)"
            class="pd-input pd-input--unit"
          >
            <option value="second">second</option>
            <option value="minute">minute</option>
            <option value="hour">hour</option>
          </select>
        </label>
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
    .pd-interval-every {
      font-size: 0.9rem;
      font-weight: 600;
      color: #374151;
      white-space: nowrap;
    }
    .pd-input--amount { width: 120px; }
    .pd-input--unit { width: 180px; }
    .pd-input--invalid { border-color: #ef4444; }
    .pd-cron-hint {
      margin: 0.25rem 0 0;
      font-size: 0.8rem;
      color: #16a34a;
    }
    .pd-cron-hint--error { color: #ef4444; }
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

  protected readonly cronHint = computed<{ valid: boolean; text: string } | null>(() => {
    const cron = this.cronValue();
    if (!cron) return null;
    if (cron.trim().split(/\s+/).length !== 5) {
      return { valid: false, text: 'Must be a 5-field cron expression (minute hour day month weekday)' };
    }
    try {
      return { valid: true, text: cronstrue.toString(cron) };
    } catch {
      return { valid: false, text: 'Invalid cron expression' };
    }
  });

  protected readonly intervalAmount = computed(() => {
    const s = this.value()?.intervalSeconds;
    return s != null ? parseIntervalSeconds(s).amount : 1;
  });

  protected readonly intervalUnit = computed<IntervalUnit>(() => {
    const s = this.value()?.intervalSeconds;
    return s != null ? parseIntervalSeconds(s).unit : 'minute';
  });

  protected setMode(m: TimerMode) {
    if (m === 'interval') {
      this.valueChange.emit({
        intervalSeconds: this.value()?.intervalSeconds ?? (1 * UNIT_MULTIPLIERS['minute']),
      });
    } else {
      this.valueChange.emit({ cron: this.value()?.cron ?? '' });
    }
  }

  protected onCronChange(cron: string) {
    this.valueChange.emit({ cron });
  }

  protected onIntervalAmountChange(amount: number) {
    this.valueChange.emit({ intervalSeconds: amount * UNIT_MULTIPLIERS[this.intervalUnit()] });
  }

  protected onIntervalUnitChange(unit: IntervalUnit) {
    this.valueChange.emit({ intervalSeconds: this.intervalAmount() * UNIT_MULTIPLIERS[unit] });
  }
}
