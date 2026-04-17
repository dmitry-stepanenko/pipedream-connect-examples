import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { Chat } from '@hashbrownai/core';

@Component({
  selector: 'esp-ai-assistant-tool-chip',
  template: `
    @let _toolCall = toolCall();
    @if (_toolCall.status === 'pending') {
      <div class="cos-loading-spinner mx-2"></div>

      <div class="tool-name">
        {{ pending() }}
      </div>
    } @else if (_toolCall.status === 'done') {
      <div class="icon">
        <i
          class="fa-solid"
          [class]="
            _toolCall.result.status === 'rejected'
              ? 'fa-triangle-exclamation'
              : 'fa-check'
          "
        ></i>
      </div>

      <div class="tool-name">
        {{ done() }}
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      color: #000;
      width: fit-content;
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'backgroundColorClass()',
  },
})
export class ToolChipComponent {
  readonly toolCall = input.required<Chat.AnyToolCall>();
  readonly pending = input.required<string>();
  readonly done = input.required<string>();

  readonly backgroundColorClass = computed(() => {
    const t = this.toolCall();
    if (t.status === 'pending') {
      return 'bg-base-200';
    }
    return t.result.status === 'rejected' ? 'bg-danger-100' : 'bg-success-100';
  });
}
